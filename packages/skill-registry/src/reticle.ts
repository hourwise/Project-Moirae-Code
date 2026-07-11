/**
 * @moirae/skill-registry — Reticle Scanner
 *
 * Reticle scans skills before admission to the registry. It inspects manifests,
 * permissions, provenance, and content for policy violations, suspicious patterns,
 * and known-dangerous indicators.
 *
 * Reticle is a deterministic static analyser — it does not execute skill code.
 * It produces a structured scan result that feeds into trust classification.
 */

import type { ReticleScanResult, ReticleFinding, SkillManifest } from './types.js';
import { ReticleVerdict, SkillKind } from './types.js';

// ═══════════════════════════════════════════════════════════════
// SCANNER INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface ReticleScanner {
  /** Scan a skill manifest and its content for policy violations. */
  scan(manifest: SkillManifest, content: string): ReticleScanResult;
  /** Get the scanner version. */
  readonly version: string;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT SCANNER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

export class DefaultReticleScanner implements ReticleScanner {
  readonly version = '0.1.0';

  scan(manifest: SkillManifest, content: string): ReticleScanResult {
    const findings: ReticleFinding[] = [];

    // Rule 1: Executable skills without provenance
    if (manifest.kind === SkillKind.Executable && !manifest.provenance) {
      findings.push({
        rule: 'RETICLE-EXEC-001',
        severity: 'error',
        message: 'Executable skill must declare provenance (source repository URL).',
        location: 'manifest.provenance',
      });
    }

    // Rule 2: Excessive permissions for skill kind
    const maxPermissionsByKind: Record<SkillKind, number> = {
      [SkillKind.Guidance]: 3,
      [SkillKind.Workflow]: 8,
      [SkillKind.Executable]: 15,
    };
    const maxAllowed = maxPermissionsByKind[manifest.kind];
    if (manifest.requestedPermissions.length > maxAllowed) {
      findings.push({
        rule: 'RETICLE-PERM-001',
        severity: 'warning',
        message: `${manifest.kind} skill requests ${manifest.requestedPermissions.length} permissions (max ${maxAllowed} recommended).`,
        location: 'manifest.requestedPermissions',
      });
    }

    // Rule 3: Executable with filesystem_write or shell_exec permissions
    const dangerousPermissions = ['filesystem_write', 'shell_exec', 'network_outbound'];
    if (manifest.kind === SkillKind.Executable) {
      const hasDangerous = manifest.requestedPermissions.some((p) =>
        dangerousPermissions.includes(p),
      );
      if (hasDangerous) {
        findings.push({
          rule: 'RETICLE-EXEC-002',
          severity: 'warning',
          message: 'Executable skill requests write, shell, or network permissions.',
          location: 'manifest.requestedPermissions',
        });
      }
    }

    // Rule 4: Guidance skill with executable-typical permissions
    if (manifest.kind === SkillKind.Guidance) {
      const suspiciousForGuidance = manifest.requestedPermissions.filter((p) =>
        dangerousPermissions.includes(p),
      );
      if (suspiciousForGuidance.length > 0) {
        findings.push({
          rule: 'RETICLE-KIND-001',
          severity: 'critical',
          message: `Guidance skill requests execution-typical permissions: ${suspiciousForGuidance.join(', ')}.`,
          location: 'manifest.requestedPermissions',
        });
      }
    }

    // Rule 5: Missing licence
    if (!manifest.licence || manifest.licence.trim().length === 0) {
      findings.push({
        rule: 'RETICLE-LIC-001',
        severity: 'warning',
        message: 'Skill manifest has no licence declared.',
        location: 'manifest.licence',
      });
    }

    // Rule 6: Suspicious content patterns (prompt injection indicators)
    const suspiciousPatterns = [
      { pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?)/i, rule: 'RETICLE-CONT-001' },
      { pattern: /bypass\s+(policy|approval|governance)/i, rule: 'RETICLE-CONT-002' },
      { pattern: /send\s+(secrets?|keys?|tokens?|credentials?)\s+to/i, rule: 'RETICLE-CONT-003' },
      { pattern: /<\s*(system|instruction|override)\s*>/i, rule: 'RETICLE-CONT-004' },
      { pattern: /delete\s+(all|everything|entire)\s/i, rule: 'RETICLE-CONT-005' },
      { pattern: /rm\s+-rf\s+/i, rule: 'RETICLE-CONT-008' },
      { pattern: /curl|wget.*\|\s*(sh|bash|zsh)/i, rule: 'RETICLE-CONT-006' },
      { pattern: /eval\s*\(|Function\s*\(.*\)\s*\(/i, rule: 'RETICLE-CONT-007' },
    ];

    for (const { pattern, rule } of suspiciousPatterns) {
      if (pattern.test(content) || pattern.test(manifest.description)) {
        findings.push({
          rule,
          severity: 'error',
          message: `Content matches suspicious pattern: ${rule}`,
          location: 'content',
        });
      }
    }

    // Rule 7: Unknown or empty publisher
    if (!manifest.publisher || manifest.publisher.trim().length === 0 || manifest.publisher === 'unknown') {
      findings.push({
        rule: 'RETICLE-PUB-001',
        severity: 'warning',
        message: 'Skill has unknown or empty publisher.',
        location: 'manifest.publisher',
      });
    }

    // Determine overall verdict
    const hasCritical = findings.some((f) => f.severity === 'critical');
    const hasError = findings.some((f) => f.severity === 'error');
    const hasWarning = findings.some((f) => f.severity === 'warning');

    let verdict: ReticleVerdict;
    if (hasCritical) {
      verdict = ReticleVerdict.Dangerous;
    } else if (hasError) {
      verdict = ReticleVerdict.Suspicious;
    } else if (hasWarning) {
      verdict = ReticleVerdict.Warning;
    } else {
      verdict = ReticleVerdict.Clean;
    }

    // Calculate risk score (0-10)
    const riskScore = Math.min(
      10,
      findings
        .map((f) => ({ info: 0, warning: 2, error: 5, critical: 8 })[f.severity] ?? 0)
        .reduce((a, b) => a + b, 0),
    );

    return {
      scannedAt: new Date().toISOString(),
      verdict,
      findings,
      riskScore,
      scannerVersion: this.version,
    };
  }
}
