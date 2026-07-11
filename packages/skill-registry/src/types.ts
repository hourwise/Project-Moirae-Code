/**
 * @moirae/skill-registry — Core Types
 *
 * Skill metadata, manifests, trust state, revision records, and lifecycle enums.
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════
// SKILL KIND
// ═══════════════════════════════════════════════════════════════

export enum SkillKind {
  /** Rules, patterns, conventions — read-only influence on model behaviour. */
  Guidance = 'guidance',
  /** Multi-step processes, task templates — orchestration of other skills/tools. */
  Workflow = 'workflow',
  /** Code that runs, tools that act — highest risk, requires strictest governance. */
  Executable = 'executable',
}

export const SkillKindSchema = z.nativeEnum(SkillKind);

// ═══════════════════════════════════════════════════════════════
// TRUST STATE
// ═══════════════════════════════════════════════════════════════

export enum SkillTrustState {
  /** Not yet scanned or classified. */
  Unclassified = 'unclassified',
  /** Passed Reticle scan, awaiting user review. */
  PendingReview = 'pending_review',
  /** User has reviewed and granted trust for this revision. */
  Trusted = 'trusted',
  /** Reticle scan flagged issues; user must explicitly override. */
  Flagged = 'flagged',
  /** Known malicious or policy-violating; blocked from installation. */
  Blocked = 'blocked',
  /** Previously trusted, now revoked due to updated scan or user action. */
  Revoked = 'revoked',
}

export const SkillTrustStateSchema = z.nativeEnum(SkillTrustState);

// ═══════════════════════════════════════════════════════════════
// SKILL MANIFEST
// ═══════════════════════════════════════════════════════════════

export const SkillManifestSchema = z.object({
  /** Unique skill identifier (e.g., "moirae.python-refactor"). */
  id: z.string().min(1),
  /** Human-readable name. */
  name: z.string().min(1),
  /** Skill kind: guidance, workflow, or executable. */
  kind: SkillKindSchema,
  /** Semantic version. */
  version: z.string().min(1),
  /** Publisher identity (individual, org, or "moirae" for first-party). */
  publisher: z.string().min(1),
  /** Short description of what the skill does. */
  description: z.string(),
  /** SPDX licence identifier. */
  licence: z.string(),
  /** URL to source repository or homepage. */
  provenance: z.string().optional(),
  /** Permissions requested by this skill. */
  requestedPermissions: z.array(z.string()),
  /** Other skill IDs this skill depends on. */
  dependencies: z.array(z.string()).optional(),
  /** Minimum Moirae Code version required. */
  minMoiraeVersion: z.string().optional(),
  /** Tags for discovery and categorization. */
  tags: z.array(z.string()).optional(),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

// ═══════════════════════════════════════════════════════════════
// SKILL RECORD (runtime state)
// ═══════════════════════════════════════════════════════════════

export interface SkillRecord {
  /** The skill manifest. */
  manifest: SkillManifest;
  /** Current trust state. */
  trustState: SkillTrustState;
  /** When the skill was first imported (ISO 8601). */
  importedAt: string;
  /** When trust was last granted (ISO 8601). */
  trustedAt: string | null;
  /** Pinned revision hash — if set, updates skip this skill. */
  pinnedRevision: string | null;
  /** Who granted trust (user identity or "system" for auto-trusted). */
  trustedBy: string | null;
  /** Installation path on disk. */
  installPath: string;
  /** Content hash at install time (SHA-256). */
  contentHash: string;
  /** Whether the skill is currently active. */
  active: boolean;
  /** Reticle scan result from last scan. */
  lastScanResult: ReticleScanResult | null;
  /** Number of times this skill has been updated. */
  updateCount: number;
  /** Previous revisions (for rollback). */
  revisionHistory: SkillRevision[];
  /** Per-project outcomes recorded for this skill. */
  projectOutcomes: SkillOutcome[];
}

export interface SkillRevision {
  version: string;
  contentHash: string;
  installedAt: string;
  trustState: SkillTrustState;
  scanResult: ReticleScanResult | null;
}

export interface SkillOutcome {
  projectId: string;
  taskId: string;
  outcome: 'success' | 'failure' | 'partial' | 'rejected';
  timestamp: string;
  notes: string;
}

// ═══════════════════════════════════════════════════════════════
// RETICLE SCAN RESULT
// ═══════════════════════════════════════════════════════════════

export interface ReticleScanResult {
  /** When the scan was performed. */
  scannedAt: string;
  /** Overall verdict. */
  verdict: ReticleVerdict;
  /** Individual findings from the scan. */
  findings: ReticleFinding[];
  /** Overall risk score (0-10). */
  riskScore: number;
  /** Scanner version. */
  scannerVersion: string;
}

export enum ReticleVerdict {
  Clean = 'clean',
  Warning = 'warning',
  Suspicious = 'suspicious',
  Dangerous = 'dangerous',
}

export interface ReticleFinding {
  rule: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  location: string;
}

// ═══════════════════════════════════════════════════════════════
// SKILL LIFECYCLE EVENTS
// ═══════════════════════════════════════════════════════════════

export enum SkillLifecycleEvent {
  Imported = 'imported',
  Inspected = 'inspected',
  Scanned = 'scanned',
  TrustGranted = 'trust_granted',
  TrustRevoked = 'trust_revoked',
  Installed = 'installed',
  Pinned = 'pinned',
  Updated = 'updated',
  RolledBack = 'rolled_back',
  Removed = 'removed',
  OutcomeRecorded = 'outcome_recorded',
}
