/**
 * Contract Tests — @moirae/runtime-contracts
 *
 * Verifies that all shared type schemas parse correctly, validate invalid inputs,
 * and maintain the contracts that Ananke, Mnemosyne, and Horae depend on.
 */

import { describe, it, expect } from 'vitest';
import {
  RuntimeIdentitySchema,
  RuntimeHealthSchema,
  OutcomeSchema,
  OutcomeState,
  RuntimeEventType,
  RuntimeBindingRole,
  RuntimeProfileMode,
  CapabilityCategory,
  RuntimeHealthStatus,
  Severity,
  ProtocolVersion,
  RUNTIME_NAMES,
} from '@moirae/runtime-contracts';

// ═══════════════════════════════════════════════════════════════
// RUNTIME IDENTITY
// ═══════════════════════════════════════════════════════════════

describe('RuntimeIdentity', () => {
  it('parses a valid Ananke identity', () => {
    const identity = RuntimeIdentitySchema.parse({
      runtime: 'ananke',
      version: '0.1.0',
      protocolVersion: '1.0.0',
      minimumProtocolVersion: '1.0.0',
      capabilities: [
        { id: 'approval', name: 'Approval', version: '0.1.0', category: 'approval' },
      ],
    });
    expect(identity.runtime).toBe('ananke');
    expect(identity.protocolVersion).toBe('1.0.0');
  });

  it('parses a valid Mnemosyne identity', () => {
    const identity = RuntimeIdentitySchema.parse({
      runtime: 'mnemosyne',
      version: '0.1.0',
      protocolVersion: '1.0.0',
      capabilities: [
        { id: 'memory', name: 'Memory', version: '0.1.0', category: 'memory' },
      ],
    });
    expect(identity.runtime).toBe('mnemosyne');
  });

  it('parses a valid Horae identity', () => {
    const identity = RuntimeIdentitySchema.parse({
      runtime: 'horae',
      version: '0.1.0',
      protocolVersion: '1.1.0',
    });
    expect(identity.runtime).toBe('horae');
  });

  it('rejects identity with missing runtime name', () => {
    expect(() => RuntimeIdentitySchema.parse({ version: '1.0', protocolVersion: '1.0' })).toThrow();
  });

  it('rejects identity with empty version', () => {
    expect(() =>
      RuntimeIdentitySchema.parse({ runtime: 'ananke', version: '', protocolVersion: '1.0' }),
    ).toThrow();
  });

  it('accepts identity without capabilities', () => {
    const identity = RuntimeIdentitySchema.parse({
      runtime: 'test-runtime',
      version: '1.0.0',
      protocolVersion: '1.0.0',
    });
    expect(identity.capabilities).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// RUNTIME HEALTH
// ═══════════════════════════════════════════════════════════════

describe('RuntimeHealth', () => {
  it('parses a healthy component', () => {
    const health = RuntimeHealthSchema.parse({
      healthy: true,
      uptimeMs: 120_000,
      warnings: [],
    });
    expect(health.healthy).toBe(true);
  });

  it('parses a degraded component with warnings', () => {
    const health = RuntimeHealthSchema.parse({
      healthy: false,
      status: 'degraded',
      uptimeMs: 5000,
      warnings: ['High memory usage', 'Slow response times'],
    });
    expect(health.healthy).toBe(false);
    expect(health.warnings).toHaveLength(2);
  });

  it('accepts all valid health statuses', () => {
    const statuses = ['healthy', 'busy', 'read_only', 'updating', 'unavailable', 'degraded'];
    for (const status of statuses) {
      expect(() =>
        RuntimeHealthSchema.parse({ healthy: true, uptimeMs: 1000, status, warnings: [] }),
      ).not.toThrow();
    }
  });

  it('rejects negative uptime', () => {
    expect(() =>
      RuntimeHealthSchema.parse({ healthy: true, uptimeMs: -1, warnings: [] }),
    ).toThrow();
  });

  it('rejects non-integer active sessions', () => {
    expect(() =>
      RuntimeHealthSchema.parse({
        healthy: true,
        uptimeMs: 1000,
        warnings: [],
        activeSessions: 1.5,
      }),
    ).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// OUTCOMES
// ═══════════════════════════════════════════════════════════════

describe('Outcome', () => {
  it('parses a COMPLETED outcome', () => {
    const outcome = OutcomeSchema.parse({
      state: 'COMPLETED',
      retryable: false,
      requiresUser: false,
      safeToContinue: true,
    });
    expect(outcome.state).toBe(OutcomeState.COMPLETED);
  });

  it('parses a DENIED outcome with reason code', () => {
    const outcome = OutcomeSchema.parse({
      state: 'DENIED',
      retryable: false,
      requiresUser: false,
      safeToContinue: false,
      reasonCode: 'POLICY_DENIED',
    });
    expect(outcome.state).toBe(OutcomeState.DENIED);
    expect(outcome.reasonCode).toBe('POLICY_DENIED');
  });

  it('parses WAITING_FOR_APPROVAL with next action', () => {
    const outcome = OutcomeSchema.parse({
      state: 'WAITING_FOR_APPROVAL',
      retryable: true,
      requiresUser: true,
      safeToContinue: false,
      nextAction: 'Approve the filesystem write in the Moirae dashboard.',
    });
    expect(outcome.state).toBe(OutcomeState.WAITING_FOR_APPROVAL);
    expect(outcome.requiresUser).toBe(true);
  });

  it('parses PARTIAL_SUCCESS with evidence', () => {
    const outcome = OutcomeSchema.parse({
      state: 'PARTIAL_SUCCESS',
      retryable: false,
      requiresUser: false,
      safeToContinue: true,
      evidence: { testsPassed: 42, testsFailed: 1 },
    });
    expect(outcome.evidence).toEqual({ testsPassed: 42, testsFailed: 1 });
  });

  it('allows all 11 outcome states', () => {
    const states = Object.values(OutcomeState);
    expect(states).toHaveLength(11);
    for (const state of states) {
      expect(() =>
        OutcomeSchema.parse({ state, retryable: false, requiresUser: false, safeToContinue: true }),
      ).not.toThrow();
    }
  });

  it('rejects invalid state strings', () => {
    expect(() =>
      OutcomeSchema.parse({
        state: 'MAYBE_LATER',
        retryable: false,
        requiresUser: false,
        safeToContinue: true,
      }),
    ).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

describe('Constants', () => {
  it('RUNTIME_NAMES includes all four Fates', () => {
    expect(RUNTIME_NAMES.ANANKE).toBe('ananke');
    expect(RUNTIME_NAMES.MNEMOSYNE).toBe('mnemosyne');
    expect(RUNTIME_NAMES.HORAE).toBe('horae');
    expect(RUNTIME_NAMES.MOIRA).toBe('moira');
  });

  it('ProtocolVersion is semver-compatible', () => {
    expect(ProtocolVersion.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(ProtocolVersion.minimumSupported).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('RuntimeEventType covers approval lifecycle', () => {
    expect(RuntimeEventType.ApprovalDenied).toBe('approval.denied');
    expect(RuntimeEventType.ApprovalGranted).toBe('approval.granted');
  });

  it('RuntimeBindingRole defines all required roles', () => {
    const roles = Object.values(RuntimeBindingRole);
    expect(roles).toContain('execution_governor');
    expect(roles).toContain('memory');
    expect(roles).toContain('orchestrator');
    expect(roles).toContain('policy');
  });

  it('CapabilityCategory includes memory and approval', () => {
    expect(CapabilityCategory.Memory).toBe('memory');
    expect(CapabilityCategory.Approval).toBe('approval');
    expect(CapabilityCategory.Orchestration).toBe('orchestration');
  });

  it('Severity levels are ordered', () => {
    expect(Severity.Info).toBe('info');
    expect(Severity.Warning).toBe('warning');
    expect(Severity.Error).toBe('error');
    expect(Severity.Critical).toBe('critical');
  });

  it('RuntimeHealthStatus covers all lifecycle states', () => {
    const statuses = Object.values(RuntimeHealthStatus);
    expect(statuses).toContain('healthy');
    expect(statuses).toContain('degraded');
    expect(statuses).toContain('unavailable');
  });

  it('RuntimeProfileMode includes personal_development and strict_enterprise', () => {
    expect(RuntimeProfileMode.PersonalDevelopment).toBe('personal_development');
    expect(RuntimeProfileMode.StrictEnterprise).toBe('strict_enterprise');
    expect(RuntimeProfileMode.Production).toBe('production');
  });
});
