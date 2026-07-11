/**
 * Contract Tests — @moirae/supervisor
 *
 * Verifies health monitoring, crash recovery, and component lifecycle.
 * These tests use the in-memory implementation since Fate processes
 * are not yet available for spawning.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  MoiraeSupervisor,
  ComponentHealthStatus,
  CrashRecoveryAction,
} from '@moirae/supervisor';
import type { SupervisorConfig } from '@moirae/supervisor';

function testConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    projectRoot: '/tmp/test-project',
    dataDir: '/tmp/test-project/.moirae',
    autoStart: false,
    healthCheckIntervalMs: 100,
    maxRestartAttempts: 3,
    restartCooldownMs: 10,
    components: {
      ananke: {
        enabled: true,
        port: 13000,
        startupTimeoutMs: 5000,
        healthEndpoint: '/health',
      },
      mnemosyne: {
        enabled: true,
        port: 13001,
        startupTimeoutMs: 5000,
        healthEndpoint: '/health',
      },
      horae: {
        enabled: false,
        port: 13002,
        startupTimeoutMs: 5000,
        healthEndpoint: '/health',
      },
    },
    ipc: { transport: 'tcp', host: '127.0.0.1', portRange: { min: 14000, max: 14100 } },
    logging: { level: 'warn', directory: '/tmp/logs', maxFileSizeBytes: 1_048_576, maxFiles: 3 },
    ...overrides,
  };
}

describe('MoiraeSupervisor', () => {
  let supervisor: MoiraeSupervisor;

  beforeEach(() => {
    vi.useFakeTimers();
    supervisor = new MoiraeSupervisor(testConfig());
  });

  afterEach(async () => {
    await supervisor.stop();
    vi.useRealTimers();
  });

  // ── Initialization ───────────────────────────────────────

  it('initializes health records for enabled components on start', async () => {
    await supervisor.start();
    const status = supervisor.status();

    expect(status).toHaveLength(2); // ananke + mnemosyne (horae disabled)
    expect(status.find((s) => s.componentId === 'ananke')?.port).toBe(13000);
    expect(status.find((s) => s.componentId === 'mnemosyne')?.port).toBe(13001);
  });

  it('does not initialize disabled components', async () => {
    await supervisor.start();
    const status = supervisor.status();
    expect(status.find((s) => s.componentId === 'horae')).toBeUndefined();
  });

  // ── Health Checks ────────────────────────────────────────

  it('runs health checks on all components', async () => {
    await supervisor.start();
    // Manual run (spawn stubbed, so health checks will fail to connect)
    const results = await supervisor.runHealthChecks();
    expect(results).toHaveLength(2);

    for (const result of results) {
      expect(result.status).toBe(ComponentHealthStatus.UNHEALTHY);
      expect(result.lastError).toBeTruthy();
      expect(result.lastCheckTime).toBeTruthy();
    }
  });

  it('emits degraded event when components are unhealthy', async () => {
    const degradedSpy = vi.fn();
    supervisor.on('supervisor:degraded', degradedSpy);

    await supervisor.start();
    await supervisor.runHealthChecks();

    expect(degradedSpy).toHaveBeenCalled();
  });

  // ── Crash Recovery ───────────────────────────────────────

  // Crash recovery tests use real timers because handleCrash calls delay().
  // We use a tiny cooldown (10ms) so tests complete quickly.

  it('handles first crash with RESTART action', async () => {
    vi.useRealTimers();
    await supervisor.start();

    const healthChangedSpy = vi.fn();
    const crashedSpy = vi.fn();
    supervisor.on('component:health-changed', healthChangedSpy);
    supervisor.on('component:crashed', crashedSpy);

    await supervisor.handleCrash('ananke', 1, null, 'Segmentation fault');

    const history = supervisor.crashHistoryFor('ananke');
    expect(history).toHaveLength(1);
    expect(history[0]!.recoveryAction).toBe(CrashRecoveryAction.RESTART);
    expect(history[0]!.restartAttempt).toBe(1);
    expect(history[0]!.stderr).toBe('Segmentation fault');

    expect(crashedSpy).toHaveBeenCalledTimes(1);
    // health-changed is emitted by health check polling, not by handleCrash directly
    // The crash event is the primary signal for crash recovery
    expect(crashedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        componentId: 'ananke',
        exitCode: 1,
        stderr: 'Segmentation fault',
        recoveryAction: CrashRecoveryAction.RESTART,
      }),
    );
    vi.useFakeTimers();
  });

  it('escalates to RESTART_WITH_BACKOFF after multiple crashes', async () => {
    vi.useRealTimers();
    await supervisor.start();

    // 2 crashes: attempts 1 and 2
    await supervisor.handleCrash('ananke', 1, null, 'Error 1');
    await supervisor.handleCrash('ananke', 1, null, 'Error 2');

    const history = supervisor.crashHistoryFor('ananke');
    expect(history).toHaveLength(2);
    expect(history[1]!.recoveryAction).toBe(CrashRecoveryAction.RESTART_WITH_BACKOFF);
    vi.useFakeTimers();
  });

  it('enters degraded mode after exceeding max restart attempts', async () => {
    vi.useRealTimers();
    await supervisor.start();

    const degradedSpy = vi.fn();
    supervisor.on('supervisor:degraded', degradedSpy);

    // 3 crashes: maxRestartAttempts is 3
    await supervisor.handleCrash('ananke', 1, null, 'Error 1');
    await supervisor.handleCrash('ananke', 1, null, 'Error 2');
    await supervisor.handleCrash('ananke', 1, null, 'Error 3');

    const history = supervisor.crashHistoryFor('ananke');
    expect(history).toHaveLength(3);
    expect(history[2]!.recoveryAction).toBe(CrashRecoveryAction.DEGRADE);

    const status = supervisor.status().find((s) => s.componentId === 'ananke');
    expect(status?.status).toBe(ComponentHealthStatus.DEGRADED);

    expect(degradedSpy).toHaveBeenCalled();
    vi.useFakeTimers();
  });

  // ── Stop ─────────────────────────────────────────────────

  it('stops all components and health checks', async () => {
    await supervisor.start();
    await supervisor.stop();

    const status = supervisor.status();
    for (const s of status) {
      expect(s.status).toBe(ComponentHealthStatus.STOPPED);
    }
  });

  // ── Empty state ──────────────────────────────────────────

  it('returns empty status before start', () => {
    const status = supervisor.status();
    expect(status).toHaveLength(0);
  });

  it('returns empty crash history for unknown component', () => {
    const history = supervisor.crashHistoryFor('unknown');
    expect(history).toHaveLength(0);
  });
});
