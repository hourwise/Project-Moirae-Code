/**
 * Contract Tests — @moirae/tool-sdk Manifest Validator
 *
 * Verifies that the manifest validator correctly validates, rejects, and warns
 * on well-formed and malformed tool manifests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ManifestValidator,
  ValidationErrorCode,
  ValidationWarningCode,
  PublisherTrust,
  RiskClass,
  SideEffectClass,
} from '@moirae/tool-sdk';

function validManifest() {
  return {
    identity: { name: 'test.tool', version: '1.0.0', publisher: 'moirae' },
    description: 'A test tool for validation.',
    riskClass: 'READ_ONLY',
    sideEffects: ['none'],
    requiresApproval: false,
    integrity: { hash: 'abc123', signatureStatus: 'verified' },
    executionConstraints: { maxDurationMs: 30000, maxOutputBytes: 1024 },
  };
}

describe('ManifestValidator', () => {
  let validator: ManifestValidator;

  beforeEach(() => {
    validator = new ManifestValidator();
    validator.trustPublisher('moirae', PublisherTrust.FIRST_PARTY);
  });

  // ── Schema Validation ────────────────────────────────────

  it('validates a well-formed manifest', () => {
    const result = validator.validate(validManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.manifest).not.toBeNull();
  });

  it('rejects a manifest with missing identity', () => {
    const result = validator.validate({ description: 'no identity' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === ValidationErrorCode.SCHEMA_INVALID)).toBe(true);
  });

  it('validates schema only (skip trust/integrity)', () => {
    expect(validator.validateSchema(validManifest())).toBe(true);
    expect(validator.validateSchema({})).toBe(false);
  });

  // ── Publisher Trust ──────────────────────────────────────

  it('accepts a trusted first-party publisher', () => {
    const result = validator.validate(validManifest());
    expect(result.errors.some((e) => e.code === ValidationErrorCode.UNTRUSTED_PUBLISHER)).toBe(false);
  });

  it('rejects a blocked publisher', () => {
    validator.blockPublisher('evil-corp');
    const result = validator.validate({
      ...validManifest(),
      identity: { name: 'bad.tool', version: '1.0', publisher: 'evil-corp' },
    });
    expect(result.errors.some((e) => e.code === ValidationErrorCode.UNTRUSTED_PUBLISHER)).toBe(true);
  });

  it('errors on missing publisher', () => {
    const result = validator.validate({
      ...validManifest(),
      identity: { name: 'anon.tool', version: '1.0', publisher: '' },
    });
    expect(result.errors.some((e) => e.code === ValidationErrorCode.MISSING_PUBLISHER)).toBe(true);
  });

  // ── Risk Class Validation ────────────────────────────────

  it('errors on UNKNOWN risk class', () => {
    const result = validator.validate({
      ...validManifest(),
      riskClass: 'UNKNOWN',
    });
    expect(result.errors.some((e) => e.code === ValidationErrorCode.UNKNOWN_RISK_CLASS)).toBe(true);
  });

  it('warns when tool has write effects but does not require approval', () => {
    const result = validator.validate({
      ...validManifest(),
      riskClass: 'INTERNAL_WRITE',
      sideEffects: ['filesystem_write'],
      requiresApproval: false,
    });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // ── Integrity Checks ─────────────────────────────────────

  it('warns when integrity hash is missing', () => {
    const manifest = validManifest();
    delete (manifest as Record<string, unknown>).integrity;
    const result = validator.validate(manifest);
    expect(result.warnings.some((w) => w.code === ValidationWarningCode.NO_INTEGRITY_HASH)).toBe(true);
  });

  it('warns on unsigned manifest', () => {
    const result = validator.validate({
      ...validManifest(),
      integrity: { hash: 'abc123', signatureStatus: 'unsigned' },
    });
    expect(result.warnings.some((w) => w.code === ValidationWarningCode.NO_SIGNATURE)).toBe(true);
  });

  // ── Data Handling ────────────────────────────────────────

  it('errors when tool sends data off-device AND stores secrets', () => {
    const result = validator.validate({
      ...validManifest(),
      sideEffects: ['network_outbound'],
      dataHandling: { storesSecrets: true, sendsDataOffDevice: true, retainsData: false },
    });
    expect(result.errors.some((e) => e.code === ValidationErrorCode.SENSITIVE_DATA_HANDLING)).toBe(true);
  });

  // ── Execution Constraints ────────────────────────────────

  it('warns when no execution constraints are defined', () => {
    const manifest = validManifest();
    delete (manifest as Record<string, unknown>).executionConstraints;
    const result = validator.validate(manifest);
    expect(result.warnings.some((w) => w.code === ValidationWarningCode.NO_EXECUTION_CONSTRAINTS)).toBe(true);
  });

  it('warns when max output size is not set', () => {
    const result = validator.validate({
      ...validManifest(),
      executionConstraints: { maxDurationMs: 30000 },
    });
    expect(result.warnings.some((w) => w.code === ValidationWarningCode.UNBOUNDED_OUTPUT)).toBe(true);
  });

  // ── Risk Assessment ──────────────────────────────────────

  it('READ_ONLY tools score 0', () => {
    const manifest = validManifest();
    const parsed = ManifestValidator.prototype.validate.call(validator, manifest);
    const score = validator.assessRisk(parsed.manifest!);
    expect(score).toBe(0);
  });

  it('DEPLOYMENT tools score 8', () => {
    const result = validator.validate({
      ...validManifest(),
      riskClass: 'DEPLOYMENT',
      sideEffects: ['network_outbound'],
      requiresApproval: true,
    });
    const score = validator.assessRisk(result.manifest!);
    expect(score).toBeGreaterThanOrEqual(8);
  });

  it('PERMISSION_CHANGE tools score 10 (max)', () => {
    const result = validator.validate({
      ...validManifest(),
      riskClass: 'PERMISSION_CHANGE',
      sideEffects: ['credential_access'],
      requiresApproval: true,
      dataHandling: { storesSecrets: true, sendsDataOffDevice: true, retainsData: true },
    });
    const score = validator.assessRisk(result.manifest!);
    expect(score).toBe(10);
  });
});
