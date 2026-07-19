/**
 * Local process observation plus read-only peer inspection. The supervisor is
 * not a Fate authority and does not spawn, execute, approve, retrieve memory,
 * or treat HTTP status as a health report.
 */
import { EventEmitter } from 'node:events';
import {
  FatesInspectionCoordinator,
  type PeerInspectionSource,
  type PeerInspectionSummary,
} from '@moirae/fates-inspection';
import {
  LocalProcessState,
  type ComponentHealth,
  type CrashRecord,
  type SupervisorConfig,
} from '@moirae/host-contracts';

export type { ComponentHealth, CrashRecord, SupervisorConfig };
export { LocalProcessState };

/** @deprecated Local process states, retained only for source compatibility. */
export const ComponentHealthStatus = {
  STARTING: LocalProcessState.Starting,
  HEALTHY: LocalProcessState.Running,
  DEGRADED: LocalProcessState.SpawnDisabled,
  UNHEALTHY: LocalProcessState.NotManaged,
  CRASHED: LocalProcessState.Crashed,
  STOPPED: LocalProcessState.NotManaged,
  RESTARTING: LocalProcessState.SpawnDisabled,
} as const;
export const CrashRecoveryAction = {
  RESTART: 'restart_disabled',
  RESTART_WITH_BACKOFF: 'restart_disabled',
  DEGRADE: 'degraded',
  STOP_ALL: 'degraded',
} as const;

export interface SupervisorEvents {
  'component:process-changed': (observation: ComponentHealth) => void;
  'component:crashed': (record: CrashRecord) => void;
  'peer:inspected': (report: PeerInspectionSummary) => void;
  'supervisor:degraded': (componentIds: string[]) => void;
}

export interface PeerObservation {
  peer: PeerInspectionSummary;
  localInspectedAt: string;
  freshness: 'fresh' | 'unavailable';
}

const redactStderr = (value: string | null): string | null => {
  if (!value) return null;
  return value
    .replace(/(?:bearer\s+\S+|api[_-]?key\s*[=:]\s*\S+|token\s*[=:]\s*\S+)/gi, '[REDACTED]')
    .slice(0, 2048);
};

export class MoiraeSupervisor extends EventEmitter {
  private readonly components = new Map<string, ComponentHealth>();
  private readonly crashHistory = new Map<string, CrashRecord[]>();
  private readonly peerObservations = new Map<string, PeerObservation>();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly config: SupervisorConfig,
    private readonly peers: PeerInspectionSource[] = [],
    private readonly instanceId = `moirae-supervisor-${process.pid}`,
    private readonly startedAt = Date.now(),
  ) {
    super();
  }

  async start(): Promise<void> {
    this.running = true;
    for (const [componentId, component] of Object.entries(this.config.components)) {
      if (!component.enabled) continue;
      this.components.set(componentId, {
        componentId,
        status: LocalProcessState.SpawnDisabled,
        pid: null,
        port: component.port ?? null,
        startedAt: null,
        exitCode: null,
        restartCount: 0,
        lastError: 'Process spawning is disabled until packaged entrypoints are proven.',
        lastObservedAt: new Date().toISOString(),
      });
    }
    await this.runHealthChecks();
    this.healthCheckTimer = setInterval(
      () => void this.runHealthChecks(),
      this.config.healthCheckIntervalMs,
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    this.healthCheckTimer = null;
    for (const [id, observed] of this.components) {
      const next = {
        ...observed,
        status: LocalProcessState.NotManaged,
        lastObservedAt: new Date().toISOString(),
      };
      this.components.set(id, next);
      this.emit('component:process-changed', next);
    }
  }

  /** Runs only configured inspection callbacks; it never assumes an HTTP surface. */
  async runHealthChecks(): Promise<ComponentHealth[]> {
    if (!this.running) return this.status();
    const coordinator = new FatesInspectionCoordinator({
      version: '0.1.0',
      instanceId: this.instanceId,
      startedAt: this.startedAt,
      peers: this.peers,
    });
    const report = await coordinator.inspect();
    for (const peer of report.peers) {
      const observation: PeerObservation = {
        peer,
        localInspectedAt: new Date().toISOString(),
        freshness: peer.availability === 'available' ? 'fresh' : 'unavailable',
      };
      this.peerObservations.set(peer.id, observation);
      this.emit('peer:inspected', peer);
    }
    return this.status();
  }

  status(): ComponentHealth[] {
    return [...this.components.values()];
  }
  peerStatus(): PeerObservation[] {
    return [...this.peerObservations.values()];
  }
  crashHistoryFor(componentId: string): CrashRecord[] {
    return this.crashHistory.get(componentId) ?? [];
  }

  async checkCompatibility(): Promise<{ compatible: boolean; issues: string[] }> {
    await this.runHealthChecks();
    const issues: string[] = [];
    for (const peer of this.peers) {
      const observation = this.peerObservations.get(peer.id)?.peer;
      if (!observation || observation.availability !== 'available') {
        issues.push(`${peer.id}: inspection unavailable`);
        continue;
      }
      if (!observation.compatibility?.compatible)
        issues.push(
          `${peer.id}: protocol incompatibility (${observation.compatibility?.reason ?? 'unknown'})`,
        );
    }
    return {
      compatible: issues.length === 0 && this.peers.length > 0,
      issues: this.peers.length === 0 ? ['No configured peer inspection sources.'] : issues,
    };
  }

  async handleCrash(
    componentId: string,
    exitCode: number | null,
    signal: string | null,
    stderr: string | null,
  ): Promise<void> {
    const current = this.components.get(componentId);
    if (!current) return;
    const restartAttempt = current.restartCount + 1;
    const record: CrashRecord = {
      componentId,
      timestamp: new Date().toISOString(),
      exitCode,
      signal,
      stderr: redactStderr(stderr),
      restartAttempt,
      recoveryAction:
        restartAttempt >= this.config.maxRestartAttempts ? 'degraded' : 'restart_disabled',
    };
    const history = [...(this.crashHistory.get(componentId) ?? []), record].slice(-20);
    this.crashHistory.set(componentId, history);
    const next: ComponentHealth = {
      ...current,
      status: LocalProcessState.Crashed,
      pid: null,
      exitCode,
      restartCount: restartAttempt,
      lastError: record.stderr ?? `Process exited (${exitCode ?? 'unknown'}).`,
      lastObservedAt: record.timestamp,
    };
    this.components.set(componentId, next);
    this.emit('component:crashed', record);
    this.emit('component:process-changed', next);
    this.emit('supervisor:degraded', [componentId]);
  }
}
