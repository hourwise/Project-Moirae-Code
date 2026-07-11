/**
 * @moirae/tool-sdk — Manifest Validator
 *
 * Validates tool manifests against the schema, checks integrity,
 * classifies risk, and produces validation reports.
 *
 * This is a pure validation layer — it does not make policy decisions.
 * Ananke will consume validated manifests at runtime for enforcement.
 */

import { ToolManifestSchema, RiskClass, SideEffectClass, type ToolManifest } from './index.js';

// ── Validation Result ───────────────────────────────────────

export interface ManifestValidationResult {
  valid: boolean;
  errors: ManifestValidationError[];
  warnings: ManifestValidationWarning[];
  manifest: ToolManifest | null;
}

export interface ManifestValidationError {
  field: string;
  message: string;
  code: ValidationErrorCode;
}

export interface ManifestValidationWarning {
  field: string;
  message: string;
  code: ValidationWarningCode;
}

export enum ValidationErrorCode {
  SCHEMA_INVALID = 'SCHEMA_INVALID',
  MISSING_PUBLISHER = 'MISSING_PUBLISHER',
  UNKNOWN_RISK_CLASS = 'UNKNOWN_RISK_CLASS',
  UNTRUSTED_PUBLISHER = 'UNTRUSTED_PUBLISHER',
  HASH_MISMATCH = 'HASH_MISMATCH',
  UNSIGNED_TOOL = 'UNSIGNED_TOOL',
  NETWORK_DESTINATION_UNVERIFIED = 'NETWORK_DESTINATION_UNVERIFIED',
  SENSITIVE_DATA_HANDLING = 'SENSITIVE_DATA_HANDLING',
  EXCESSIVE_PERMISSIONS = 'EXCESSIVE_PERMISSIONS',
}

export enum ValidationWarningCode {
  NO_INTEGRITY_HASH = 'NO_INTEGRITY_HASH',
  NO_SIGNATURE = 'NO_SIGNATURE',
  DEPRECATED_VERSION = 'DEPRECATED_VERSION',
  MISSING_DESCRIPTION = 'MISSING_DESCRIPTION',
  NO_EXECUTION_CONSTRAINTS = 'NO_EXECUTION_CONSTRAINTS',
  UNBOUNDED_OUTPUT = 'UNBOUNDED_OUTPUT',
}

// ── Publisher Trust ─────────────────────────────────────────

export enum PublisherTrust {
  FIRST_PARTY = 'first_party',    // Signed by Moirae/PGCSoft
  VERIFIED = 'verified',           // Signed by a known trusted publisher
  COMMUNITY = 'community',         // Unsigned or self-signed
  UNKNOWN = 'unknown',             // No publisher info
}

// ── Manifest Validator ──────────────────────────────────────

export class ManifestValidator {
  private trustedPublishers: Set<string> = new Set();
  private blockedPublishers: Set<string> = new Set();

  /** Register a publisher as trusted (first-party or verified). */
  trustPublisher(publisher: string, trust: PublisherTrust): void {
    if (trust === PublisherTrust.FIRST_PARTY || trust === PublisherTrust.VERIFIED) {
      this.trustedPublishers.add(publisher);
    }
  }

  /** Block a publisher entirely. */
  blockPublisher(publisher: string): void {
    this.blockedPublishers.add(publisher);
  }

  /**
   * Validate a raw tool manifest object against the full schema and
   * perform integrity, trust, and risk checks.
   */
  validate(raw: unknown): ManifestValidationResult {
    const errors: ManifestValidationError[] = [];
    const warnings: ManifestValidationWarning[] = [];
    let manifest: ToolManifest | null = null;

    // 1. Schema validation
    const parsed = ToolManifestSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          field: issue.path.join('.'),
          message: issue.message,
          code: ValidationErrorCode.SCHEMA_INVALID,
        });
      }
      return { valid: false, errors, warnings, manifest: null };
    }

    manifest = parsed.data;

    // 2. Publisher trust check
    const publisher = manifest.identity.publisher;
    if (!publisher || publisher.trim().length === 0) {
      errors.push({
        field: 'identity.publisher',
        message: 'Tool manifest must declare a publisher.',
        code: ValidationErrorCode.MISSING_PUBLISHER,
      });
    } else if (this.blockedPublishers.has(publisher)) {
      errors.push({
        field: 'identity.publisher',
        message: `Publisher '${publisher}' is blocked by policy.`,
        code: ValidationErrorCode.UNTRUSTED_PUBLISHER,
      });
    }

    // 3. Risk class validation
    if (manifest.riskClass === RiskClass.UNKNOWN) {
      errors.push({
        field: 'riskClass',
        message: 'UNKNOWN risk class defaults to DENY. Explicitly classify this tool.',
        code: ValidationErrorCode.UNKNOWN_RISK_CLASS,
      });
    }

    // 4. Side-effect consistency checks
    if (manifest.sideEffects.length === 0 && manifest.riskClass !== RiskClass.READ_ONLY) {
      warnings.push({
        field: 'sideEffects',
        message: `Risk class '${manifest.riskClass}' declared but no side effects listed.`,
        code: ValidationWarningCode.MISSING_DESCRIPTION,
      });
    }

    const hasWriteEffect = manifest.sideEffects.some(
      (s) => s === SideEffectClass.FILESYSTEM_WRITE || s === SideEffectClass.NETWORK_OUTBOUND || s === SideEffectClass.SHELL_EXEC,
    );
    if (hasWriteEffect && !manifest.requiresApproval) {
      warnings.push({
        field: 'requiresApproval',
        message: 'Tool has write/network/shell side effects but does not require approval.',
        code: ValidationWarningCode.NO_EXECUTION_CONSTRAINTS,
      });
    }

    // 5. Integrity checks
    if (!manifest.integrity?.hash) {
      warnings.push({
        field: 'integrity.hash',
        message: 'No integrity hash provided. Tool cannot be verified.',
        code: ValidationWarningCode.NO_INTEGRITY_HASH,
      });
    }

    if (!manifest.integrity?.signatureStatus || manifest.integrity.signatureStatus === 'unsigned') {
      warnings.push({
        field: 'integrity.signatureStatus',
        message: 'Tool manifest is unsigned.',
        code: ValidationWarningCode.NO_SIGNATURE,
      });
    }

    // 6. Network destination validation
    if (manifest.sideEffects.includes(SideEffectClass.NETWORK_OUTBOUND)) {
      if (!manifest.networkDestinations || manifest.networkDestinations.length === 0) {
        warnings.push({
          field: 'networkDestinations',
          message: 'Tool declares network_outbound side effect but lists no destinations.',
          code: ValidationWarningCode.NO_EXECUTION_CONSTRAINTS,
        });
      }
    }

    // 7. Data handling
    if (manifest.dataHandling?.sendsDataOffDevice && manifest.dataHandling?.storesSecrets) {
      errors.push({
        field: 'dataHandling',
        message: 'Tool sends data off-device AND stores secrets. This is a critical risk combination.',
        code: ValidationErrorCode.SENSITIVE_DATA_HANDLING,
      });
    }

    // 8. Execution constraints
    if (!manifest.executionConstraints) {
      warnings.push({
        field: 'executionConstraints',
        message: 'No execution constraints defined (no timeout, no output cap, no working directory restriction).',
        code: ValidationWarningCode.NO_EXECUTION_CONSTRAINTS,
      });
    } else if (!manifest.executionConstraints.maxOutputBytes) {
      warnings.push({
        field: 'executionConstraints.maxOutputBytes',
        message: 'No output size limit set.',
        code: ValidationWarningCode.UNBOUNDED_OUTPUT,
      });
    }

    const valid = errors.length === 0;
    return { valid, errors, warnings, manifest };
  }

  /**
   * Quick-check: does the manifest pass schema validation only (no trust/integrity checks)?
   */
  validateSchema(raw: unknown): boolean {
    return ToolManifestSchema.safeParse(raw).success;
  }

  /**
   * Determine how risky a tool is on a 0-10 scale.
   */
  assessRisk(manifest: ToolManifest): number {
    const riskScores: Record<RiskClass, number> = {
      [RiskClass.READ_ONLY]: 0,
      [RiskClass.INTERNAL_WRITE]: 3,
      [RiskClass.EXTERNAL_SEND]: 5,
      [RiskClass.DELETE]: 6,
      [RiskClass.PAYMENT]: 9,
      [RiskClass.DEPLOYMENT]: 8,
      [RiskClass.PERMISSION_CHANGE]: 10,
      [RiskClass.UNKNOWN]: 10,
    };

    let score = riskScores[manifest.riskClass] ?? 10;

    // Increase score for sensitive combinations
    if (manifest.dataHandling?.sendsDataOffDevice) score += 1;
    if (manifest.dataHandling?.storesSecrets) score += 2;
    if (!manifest.executionConstraints) score += 1;
    if (!manifest.integrity?.hash) score += 1;

    return Math.min(10, score);
  }
}
