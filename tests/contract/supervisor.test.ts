import { describe, expect, it } from 'vitest';
import { MoiraeSupervisor, LocalProcessState, type SupervisorConfig } from '@moirae/supervisor';
import { createMoiraeRuntimeInspection } from '@moirae/adrasteia-adapter';

const config = (): SupervisorConfig => ({
  projectRoot: 'workspace',
  dataDir: 'runtime-data',
  autoStart: false,
  healthCheckIntervalMs: 60_000,
  maxRestartAttempts: 2,
  restartCooldownMs: 1,
  components: {
    ananke: { enabled: true, port: 13000, startupTimeoutMs: 1 },
    mnemosyne: { enabled: true, port: 13001, startupTimeoutMs: 1 },
    horae: { enabled: false, port: 13002, startupTimeoutMs: 1 },
  },
});
const peer = (runtime: 'ananke' | 'mnemosyne' | 'horae') => {
  const inspection = structuredClone(
    createMoiraeRuntimeInspection({ version: '0.1.0', instanceId: runtime, startedAt: Date.now() }),
  );
  inspection.identity.runtime = runtime;
  inspection.registration.identity.runtime = runtime;
  inspection.compatibility.runtimeName = runtime;
  return inspection;
};

describe('MoiraeSupervisor Stage-A observation model', () => {
  it('records spawn as disabled rather than pretending processes are running', async () => {
    const supervisor = new MoiraeSupervisor(config());
    await supervisor.start();
    expect(supervisor.status().map((item) => item.status)).toEqual([
      LocalProcessState.SpawnDisabled,
      LocalProcessState.SpawnDisabled,
    ]);
    await supervisor.stop();
  });
  it('stores peer-reported health separately from local process observation', async () => {
    const supervisor = new MoiraeSupervisor(config(), [
      { id: 'ananke', inspect: () => peer('ananke') },
    ]);
    await supervisor.start();
    expect(supervisor.status()[0]?.status).toBe(LocalProcessState.SpawnDisabled);
    expect(supervisor.peerStatus()[0]?.peer.inspection?.health.healthy).toBe(true);
    await supervisor.stop();
  });
  it('does real canonical compatibility instead of returning true unconditionally', async () => {
    const supervisor = new MoiraeSupervisor(config(), [
      { id: 'ananke', inspect: () => peer('ananke') },
    ]);
    await supervisor.start();
    expect(await supervisor.checkCompatibility()).toMatchObject({ compatible: true, issues: [] });
    await supervisor.stop();
    const unavailable = new MoiraeSupervisor(config());
    await unavailable.start();
    expect((await unavailable.checkCompatibility()).compatible).toBe(false);
    await unavailable.stop();
  });
  it('caps and redacts crash records and never claims session recovery', async () => {
    const supervisor = new MoiraeSupervisor(config());
    await supervisor.start();
    for (let index = 0; index < 22; index++)
      await supervisor.handleCrash('ananke', 1, null, 'Authorization: Bearer secret-value');
    const records = supervisor.crashHistoryFor('ananke');
    expect(records).toHaveLength(20);
    expect(records[0]?.stderr).not.toContain('secret-value');
    expect(supervisor.status()[0]?.status).toBe(LocalProcessState.Crashed);
    await supervisor.stop();
  });
});
