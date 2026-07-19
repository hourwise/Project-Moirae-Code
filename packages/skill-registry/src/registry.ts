/**
 * @moirae/skill-registry — Skill Registry
 *
 * Governed lifecycle for skills: import → inspect → classify → install → pin → update → rollback.
 *
 * Every state transition is recorded. Trust decisions are explicit. Unknown skills
 * default to Unclassified and are not activated until reviewed.
 */

import { EventEmitter } from 'node:events';
import type {
  SkillManifest,
  SkillRecord,
  SkillRevision,
  SkillOutcome,
  ReticleScanResult,
} from './types.js';
import { SkillTrustState, SkillKind, SkillLifecycleEvent } from './types.js';
import { SkillManifestSchema } from './types.js';
import type { ReticleScanner } from './reticle.js';
import { DefaultReticleScanner } from './reticle.js';

// ═══════════════════════════════════════════════════════════════
// REGISTRY EVENTS
// ═══════════════════════════════════════════════════════════════

export interface SkillRegistryEvents {
  'skill:imported': (record: SkillRecord) => void;
  'skill:scanned': (record: SkillRecord, result: ReticleScanResult) => void;
  'skill:trusted': (record: SkillRecord) => void;
  'skill:installed': (record: SkillRecord) => void;
  'skill:updated': (record: SkillRecord, previousVersion: string) => void;
  'skill:rolled-back': (record: SkillRecord, targetVersion: string) => void;
  'skill:removed': (skillId: string) => void;
  'skill:blocked': (skillId: string, reason: string) => void;
}

// ═══════════════════════════════════════════════════════════════
// REGISTRY IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

export class SkillRegistry extends EventEmitter {
  private skills = new Map<string, SkillRecord>();
  private scanner: ReticleScanner;
  private trustedPublishers = new Set<string>(['moirae']);
  private blockedSkillIds = new Set<string>();

  constructor(scanner?: ReticleScanner) {
    super();
    this.scanner = scanner ?? new DefaultReticleScanner();
  }

  // ═══════════════════════════════════════════════════════════
  // IMPORT
  // ═══════════════════════════════════════════════════════════

  /**
   * Import a skill from a raw manifest. Validates schema, checks for blocked
   * IDs, and creates an Unclassified record. The skill is NOT active until
   * scanned, trusted, and installed.
   */
  import(raw: unknown, content: string, installPath: string): SkillRecord {
    // 1. Validate manifest schema
    const parsed = SkillManifestSchema.parse(raw);

    // 2. Check if blocked
    if (this.blockedSkillIds.has(parsed.id)) {
      this.emit('skill:blocked', parsed.id, `Skill "${parsed.id}" is blocked by registry policy.`);
      throw new Error(`Skill "${parsed.id}" is blocked.`);
    }

    // 3. Check if already imported (update instead)
    const existing = this.skills.get(parsed.id);
    if (existing) {
      return this.update(parsed.id, raw, content);
    }

    // 4. Compute content hash
    const contentHash = this.hashContent(content);

    // 5. Create record
    const record: SkillRecord = {
      manifest: parsed,
      trustState: SkillTrustState.Unclassified,
      importedAt: new Date().toISOString(),
      trustedAt: null,
      pinnedRevision: null,
      trustedBy: null,
      installPath,
      contentHash,
      active: false,
      installed: false,
      enabled: false,
      exposed: false,
      lastScanResult: null,
      updateCount: 0,
      revisionHistory: [],
      projectOutcomes: [],
    };

    this.skills.set(parsed.id, record);
    this.emit('skill:imported', record);

    // 6. Auto-scan with Reticle
    const scanResult = this.scanner.scan(parsed, content);
    record.lastScanResult = scanResult;
    this.emit('skill:scanned', record, scanResult);

    // 7. Auto-classify based on scan verdict
    this.autoClassify(record);

    return record;
  }

  // ═══════════════════════════════════════════════════════════
  // INSPECT
  // ═══════════════════════════════════════════════════════════

  /** Inspect a skill manifest without importing it. Returns scan results. */
  inspect(
    raw: unknown,
    content: string,
  ): {
    valid: boolean;
    manifest: SkillManifest | null;
    scanResult: ReticleScanResult | null;
    errors: string[];
  } {
    const errors: string[] = [];
    let manifest: SkillManifest | null = null;
    let scanResult: ReticleScanResult | null = null;

    const parsed = SkillManifestSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`${issue.path.join('.')}: ${issue.message}`);
      }
      return { valid: false, manifest: null, scanResult: null, errors };
    }

    manifest = parsed.data;
    scanResult = this.scanner.scan(manifest, content);

    return { valid: true, manifest, scanResult, errors };
  }

  // ═══════════════════════════════════════════════════════════
  // TRUST CLASSIFICATION
  // ═══════════════════════════════════════════════════════════

  /** Grant trust to a skill revision. Required before installation. */
  trust(skillId: string, trustedBy: string): SkillRecord {
    const record = this.getOrThrow(skillId);

    if (record.trustState === SkillTrustState.Blocked) {
      throw new Error(`Cannot trust blocked skill "${skillId}".`);
    }

    record.trustState = SkillTrustState.Trusted;
    record.trustedAt = new Date().toISOString();
    record.trustedBy = trustedBy;

    this.emit('skill:trusted', record);
    return record;
  }

  /** Revoke trust from a previously trusted skill. */
  revoke(skillId: string, reason: string): SkillRecord {
    const record = this.getOrThrow(skillId);

    record.trustState = SkillTrustState.Revoked;
    record.active = false;
    record.enabled = false;
    record.exposed = false;

    this.emit('skill:trusted', record);
    return record;
  }

  /** Block a skill ID entirely — prevents import and installation. */
  block(skillId: string): void {
    this.blockedSkillIds.add(skillId);
    if (this.skills.has(skillId)) {
      const record = this.skills.get(skillId)!;
      record.trustState = SkillTrustState.Blocked;
      record.active = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // INSTALL
  // ═══════════════════════════════════════════════════════════

  /** Install a trusted skill. Installation does not enable or expose it. */
  install(skillId: string): SkillRecord {
    const record = this.getOrThrow(skillId);

    if (record.trustState !== SkillTrustState.Trusted) {
      throw new Error(
        `Skill "${skillId}" must be Trusted before installation (current: ${record.trustState}).`,
      );
    }

    record.installed = true;
    // Preserve the legacy lifecycle marker for installed records.  Capability
    // exposure remains separately gated by `enabled` and `exposed`.
    record.active = true;
    this.emit('skill:installed', record);
    return record;
  }

  /** Enable an installed skill locally; execution remains proposal-only. */
  enable(skillId: string): SkillRecord {
    const record = this.getOrThrow(skillId);
    if (!record.installed || record.trustState !== SkillTrustState.Trusted)
      throw new Error(`Skill "${skillId}" must be installed and Trusted before enablement.`);
    record.enabled = true;
    record.active = true;
    return record;
  }

  /** Expose metadata to a model. Exposure is descriptive and never authorization. */
  expose(skillId: string): SkillRecord {
    const record = this.getOrThrow(skillId);
    if (!record.enabled) throw new Error(`Skill "${skillId}" must be enabled before exposure.`);
    record.exposed = true;
    return record;
  }

  admission(skillId: string): { exposed: boolean; authorized: false; reason: string } {
    const record = this.getOrThrow(skillId);
    return {
      exposed: record.exposed,
      authorized: false,
      reason:
        'Skill evidence, trust, and exposure do not grant action authority; model calls remain proposals.',
    };
  }

  // ═══════════════════════════════════════════════════════════
  // PIN
  // ═══════════════════════════════════════════════════════════

  /** Pin a skill to its current revision — prevents automatic updates. */
  pin(skillId: string): SkillRecord {
    const record = this.getOrThrow(skillId);
    record.pinnedRevision = record.contentHash;
    return record;
  }

  /** Unpin a skill, allowing updates again. */
  unpin(skillId: string): SkillRecord {
    const record = this.getOrThrow(skillId);
    record.pinnedRevision = null;
    return record;
  }

  // ═══════════════════════════════════════════════════════════
  // UPDATE
  // ═══════════════════════════════════════════════════════════

  /** Update a skill to a new manifest version. Preserves revision history. */
  update(skillId: string, raw: unknown, content: string): SkillRecord {
    const record = this.getOrThrow(skillId);

    // If pinned, reject update
    if (record.pinnedRevision) {
      throw new Error(
        `Skill "${skillId}" is pinned at revision ${record.pinnedRevision}. Unpin first.`,
      );
    }

    const parsed = SkillManifestSchema.parse(raw);
    const newHash = this.hashContent(content);

    // Don't update if same hash
    if (newHash === record.contentHash) {
      return record;
    }

    // Save current state as a revision
    const revision: SkillRevision = {
      version: record.manifest.version,
      contentHash: record.contentHash,
      installedAt: record.importedAt,
      trustState: record.trustState,
      scanResult: record.lastScanResult,
    };
    record.revisionHistory.push(revision);

    // Scan the new content
    const scanResult = this.scanner.scan(parsed, content);

    // Update record
    const previousVersion = record.manifest.version;
    record.manifest = parsed;
    record.contentHash = newHash;
    record.lastScanResult = scanResult;
    record.updateCount++;
    record.importedAt = new Date().toISOString();
    record.trustState = SkillTrustState.PendingReview; // Re-review required
    record.trustedAt = null;
    record.trustedBy = null;
    record.active = false;
    record.enabled = false;
    record.exposed = false;

    // Re-classify
    this.autoClassify(record);

    this.emit('skill:updated', record, previousVersion);
    return record;
  }

  // ═══════════════════════════════════════════════════════════
  // ROLLBACK
  // ═══════════════════════════════════════════════════════════

  /** Roll back to a previous revision by index in revisionHistory. */
  rollback(skillId: string, revisionIndex: number): SkillRecord {
    const record = this.getOrThrow(skillId);

    const revision = record.revisionHistory[revisionIndex];
    if (!revision) {
      throw new Error(`Revision index ${revisionIndex} does not exist for skill "${skillId}".`);
    }

    // Save current as revision before rolling back
    const currentRevision: SkillRevision = {
      version: record.manifest.version,
      contentHash: record.contentHash,
      installedAt: record.importedAt,
      trustState: record.trustState,
      scanResult: record.lastScanResult,
    };
    record.revisionHistory.push(currentRevision);

    // Restore from target revision
    record.contentHash = revision.contentHash;
    record.trustState = revision.trustState;
    record.lastScanResult = revision.scanResult;
    record.active = false;
    record.enabled = false;
    record.exposed = false;

    this.emit('skill:rolled-back', record, revision.version);
    return record;
  }

  // ═══════════════════════════════════════════════════════════
  // OUTCOMES
  // ═══════════════════════════════════════════════════════════

  /** Record a project-specific outcome for a skill. */
  recordOutcome(skillId: string, outcome: SkillOutcome): void {
    const record = this.getOrThrow(skillId);
    record.projectOutcomes.push(outcome);
  }

  // ═══════════════════════════════════════════════════════════
  // QUERIES
  // ═══════════════════════════════════════════════════════════

  /** Get a skill record by ID. */
  get(skillId: string): SkillRecord | undefined {
    return this.skills.get(skillId);
  }

  /** List all imported skills. */
  list(): SkillRecord[] {
    return [...this.skills.values()];
  }

  /** List skills by trust state. */
  listByTrust(state: SkillTrustState): SkillRecord[] {
    return this.list().filter((s) => s.trustState === state);
  }

  /** List skills by kind. */
  listByKind(kind: SkillKind): SkillRecord[] {
    return this.list().filter((s) => s.manifest.kind === kind);
  }

  /** List active (installed + trusted) skills. */
  listActive(): SkillRecord[] {
    return this.list().filter((s) => s.active);
  }

  /** List skills from a specific publisher. */
  listByPublisher(publisher: string): SkillRecord[] {
    return this.list().filter((s) => s.manifest.publisher === publisher);
  }

  /** Get performance statistics for a skill. */
  getPerformance(skillId: string): {
    total: number;
    success: number;
    failure: number;
    successRate: number;
  } {
    const record = this.getOrThrow(skillId);
    const outcomes = record.projectOutcomes;
    const total = outcomes.length;
    const success = outcomes.filter((o) => o.outcome === 'success').length;
    const failure = outcomes.filter((o) => o.outcome === 'failure').length;
    return {
      total,
      success,
      failure,
      successRate: total > 0 ? success / total : 0,
    };
  }

  /** Remove a skill entirely from the registry. */
  remove(skillId: string): void {
    if (!this.skills.has(skillId)) {
      throw new Error(`Skill "${skillId}" not found.`);
    }
    this.skills.delete(skillId);
    this.emit('skill:removed', skillId);
  }

  /** Register a publisher as trusted (auto-trusts their skills). */
  trustPublisher(publisher: string): void {
    this.trustedPublishers.add(publisher);
  }

  // ═══════════════════════════════════════════════════════════
  // INTERNAL
  // ═══════════════════════════════════════════════════════════

  private getOrThrow(skillId: string): SkillRecord {
    const record = this.skills.get(skillId);
    if (!record) {
      throw new Error(`Skill "${skillId}" not found in registry.`);
    }
    return record;
  }

  /** Auto-classify a skill based on Reticle scan results and publisher trust. */
  private autoClassify(record: SkillRecord): void {
    const scan = record.lastScanResult;
    if (!scan) return;

    // Auto-trust first-party publishers if scan is clean
    if (scan.verdict === 'clean' && this.trustedPublishers.has(record.manifest.publisher)) {
      record.trustState = SkillTrustState.Trusted;
      record.trustedAt = new Date().toISOString();
      record.trustedBy = 'system';
      return;
    }

    // Auto-block dangerous skills
    if (scan.verdict === 'dangerous') {
      record.trustState = SkillTrustState.Blocked;
      return;
    }

    // Flag suspicious skills for review
    if (scan.verdict === 'suspicious') {
      record.trustState = SkillTrustState.Flagged;
      return;
    }

    // Warnings → pending review
    if (scan.verdict === 'warning') {
      record.trustState = SkillTrustState.PendingReview;
      return;
    }

    // Clean from unknown publisher → pending review
    record.trustState = SkillTrustState.PendingReview;
  }

  /** Simple content hashing (SHA-256 substitute for now). */
  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32-bit integer
    }
    return 'sk_' + Math.abs(hash).toString(16).padStart(8, '0');
  }
}
