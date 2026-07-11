/**
 * @moirae/supervisor — Local control plane for the Moirae runtime ecosystem.
 *
 * Responsibilities:
 *   - Process startup/shutdown for Ananke, Mnemosyne, Horae
 *   - Service discovery and health monitoring
 *   - Database migrations (per-runtime SQLite)
 *   - Crash recovery with state reconstruction
 *   - Local session credentials
 *   - Component version compatibility checks
 *
 * The supervisor does NOT run the Fates inside the extension host.
 * Each Fate runs as a separate process for crash isolation.
 *
 * Currently: health check + crash recovery logic implemented.
 * Process spawning is stubbed until the external Fates reach minimum viability.
 */

import { EventEmitter } from 'node:events';
import type {
  ComponentHealth,
  CrashRecord,
  SupervisorConfig as MoiraeSupervisorConfig,
  ComponentConfig,
} from '@moirae/runtime-contracts';
import {
  ComponentHealthStatus,
  CrashRecoveryAction,
} from '@moirae/runtime-contracts';

// ── Re-export types for convenience ─────────────────────────

export type { ComponentHealth, CrashRecord, MoiraeSupervisorConfig as SupervisorConfig };
export { ComponentHealthStatus, CrashRecoveryAction };

// ── Events ──────────────────────────────────────────────────

export interface SupervisorEvents {
  'component:health-changed': (health: ComponentHealth) => void;
  'component:crashed': (record: CrashRecord) => void;
  'component:recovered': (componentId: string) => void;
  'supervisor:degraded': (componentIds: string[]) => void;
  'supervisor:healthy': () => void;
}

// ── Supervisor Implementation ───────────────────────────────

export class MoiraeSupervisor extends EventEmitter {
  private components = new Map<string, ComponentHealth>();
  private crashHistory = new Map<string, CrashRecord[]>();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private config: MoiraeSupervisorConfig) {
    super();
  }

  // ═══════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════

  /** Start all enabled components and begin health monitoring. */
  async start(): Promise<void> {
    this.running = true;
    console.log('[supervisor] Starting Moirae runtime components...');

    // Initialize health records for all configured components
    for (const [name, compConfig] of Object.entries(this.config.components)) {
      if (!compConfig.enabled) continue;

      this.components.set(name, {
        componentId: name,
        status: ComponentHealthStatus.STARTING,
        pid: null,
        port: compConfig.port,
        uptimeMs: 0,
        restartCount: 0,
        lastError: null,
        lastCheckTime: new Date().toISOString(),
      });
    }

    // Spawn component processes (stubbed until Fate runtimes are available)
    await this.spawnAllComponents();

    // Begin health check polling
    this.startHealthChecks();
  }

  /** Gracefully stop all managed components and health monitoring. */
  async stop(): Promise<void> {
    this.running = false;
    this.stopHealthChecks();

    console.log('[supervisor] Stopping all components...');

    for (const [name, health] of this.components) {
      if (health.pid) {
        await this.killComponent(name, health.pid);
      }
      health.status = ComponentHealthStatus.STOPPED;
    }

    this.emit('supervisor:healthy');
  }

  // ═══════════════════════════════════════════════════════════
  // HEALTH MONITORING
  // ═══════════════════════════════════════════════════════════

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(
      () => void this.runHealthChecks(),
      this.config.healthCheckIntervalMs,
    );
  }

  private stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /** Run health checks against all managed components. */
  async runHealthChecks(): Promise<ComponentHealth[]> {
    const results: ComponentHealth[] = [];

    for (const [name, health] of this.components) {
      if (!this.running || health.status === ComponentHealthStatus.STOPPED) continue;

      const componentConfig = this.getComponentConfig(name);
      if (!componentConfig) continue;

      const updated = await this.checkComponentHealth(name, health, componentConfig);
      this.components.set(name, updated);
      results.push(updated);
    }

    // Detect overall degraded state
    const unhealthy = results.filter(
      (h) => h.status === ComponentHealthStatus.UNHEALTHY || h.status === ComponentHealthStatus.CRASHED,
    );
    if (unhealthy.length > 0) {
      this.emit('supervisor:degraded', unhealthy.map((h) => h.componentId));
    } else if (results.every((h) => h.status === ComponentHealthStatus.HEALTHY)) {
      this.emit('supervisor:healthy');
    }

    return results;
  }

  private async checkComponentHealth(
    name: string,
    current: ComponentHealth,
    config: ComponentConfig,
  ): Promise<ComponentHealth> {
    const now = new Date().toISOString();

    try {
      const url = `http://127.0.0.1:${config.port}${config.healthEndpoint}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const previousStatus = current.status;
        const updated: ComponentHealth = {
          ...current,
          status: ComponentHealthStatus.HEALTHY,
          uptimeMs: current.uptimeMs + this.config.healthCheckIntervalMs,
          lastError: null,
          lastCheckTime: now,
        };

        if (previousStatus !== ComponentHealthStatus.HEALTHY) {
          this.emit('component:health-changed', updated);
          if (previousStatus === ComponentHealthStatus.CRASHED || previousStatus === ComponentHealthStatus.UNHEALTHY) {
            this.emit('component:recovered', name);
          }
        }

        return updated;
      }

      // Endpoint returned non-200
      return {
        ...current,
        status: ComponentHealthStatus.DEGRADED,
        lastError: `HTTP ${res.status}`,
        lastCheckTime: now,
      };
    } catch (err) {
      // Connection refused or timeout — component may be down
      return {
        ...current,
        status: ComponentHealthStatus.UNHEALTHY,
        lastError: err instanceof Error ? err.message : 'Unknown error',
        lastCheckTime: now,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CRASH RECOVERY
  // ═══════════════════════════════════════════════════════════

  /** Handle a component crash: determine recovery action, record it, and act. */
  async handleCrash(componentId: string, exitCode: number | null, signal: string | null, stderr: string | null): Promise<void> {
    const health = this.components.get(componentId);
    if (!health) return;

    const history = this.crashHistory.get(componentId) ?? [];
    const restartAttempt = health.restartCount + 1;

    // Determine recovery action based on restart count vs max allowed
    let recoveryAction: CrashRecoveryAction;
    if (restartAttempt >= this.config.maxRestartAttempts) {
      recoveryAction = CrashRecoveryAction.DEGRADE;
    } else if (restartAttempt >= Math.floor(this.config.maxRestartAttempts * 0.7)) {
      recoveryAction = CrashRecoveryAction.RESTART_WITH_BACKOFF;
    } else {
      recoveryAction = CrashRecoveryAction.RESTART;
    }

    const record: CrashRecord = {
      componentId,
      timestamp: new Date().toISOString(),
      exitCode,
      signal,
      stderr,
      restartAttempt,
      recoveryAction,
    };

    history.push(record);
    this.crashHistory.set(componentId, history);

    // Update component health
    const updated: ComponentHealth = {
      ...health,
      status: ComponentHealthStatus.CRASHED,
      pid: null,
      lastError: stderr ?? `Exit code: ${exitCode}`,
      restartCount: restartAttempt,
      lastCheckTime: record.timestamp,
    };
    this.components.set(componentId, updated);

    this.emit('component:crashed', record);

    // Execute recovery action
    switch (recoveryAction) {
      case CrashRecoveryAction.RESTART:
        console.log(`[supervisor] Restarting ${componentId} (attempt ${restartAttempt})...`);
        updated.status = ComponentHealthStatus.RESTARTING;
        await this.delay(this.config.restartCooldownMs);
        await this.spawnComponent(componentId);
        break;

      case CrashRecoveryAction.RESTART_WITH_BACKOFF:
        console.log(`[supervisor] Restarting ${componentId} with backoff (attempt ${restartAttempt})...`);
        updated.status = ComponentHealthStatus.RESTARTING;
        await this.delay(this.config.restartCooldownMs * restartAttempt);
        await this.spawnComponent(componentId);
        break;

      case CrashRecoveryAction.DEGRADE:
        console.error(`[supervisor] ${componentId} exceeded max restart attempts (${this.config.maxRestartAttempts}). Entering degraded mode.`);
        updated.status = ComponentHealthStatus.DEGRADED;
        this.components.set(componentId, updated);
        this.emit('supervisor:degraded', [componentId]);
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PROCESS MANAGEMENT (stubbed until Fate runtimes available)
  // ═══════════════════════════════════════════════════════════

  private async spawnAllComponents(): Promise<void> {
    for (const [name] of this.components) {
      await this.spawnComponent(name);
    }
  }

  private async spawnComponent(_componentId: string): Promise<void> {
    // TODO: Use child_process.spawn() to launch Ananke/Mnemosyne/Horae processes.
    // Each process gets:
    //   - Isolated environment variables
    //   - Separate SQLite database path
    //   - Assigned port from config
    //   - stdio piped for health check communication
    //
    // Implementation blocked until Fate runtimes have stable CLI entrypoints.
    console.log(`[supervisor] Component '${_componentId}' spawn stubbed — Fate runtime not yet available.`);
  }

  private async killComponent(_componentId: string, pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM');
      // Wait up to 10 seconds for graceful shutdown
      await this.waitForExit(pid, 10_000);
    } catch {
      // Force kill if still running
      try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
    }
  }

  private async waitForExit(_pid: number, _timeoutMs: number): Promise<void> {
    // TODO: Poll process.kill(pid, 0) until it throws
  }

  // ═══════════════════════════════════════════════════════════
  // QUERIES
  // ═══════════════════════════════════════════════════════════

  /** Returns the health status of all managed components. */
  status(): ComponentHealth[] {
    return [...this.components.values()];
  }

  /** Get crash history for a component. */
  crashHistoryFor(componentId: string): CrashRecord[] {
    return this.crashHistory.get(componentId) ?? [];
  }

  /** Check component version compatibility before starting. */
  async checkCompatibility(): Promise<{ compatible: boolean; issues: string[] }> {
    // TODO: Query each component's RuntimeIdentity endpoint and compare protocol versions
    return { compatible: true, issues: [] };
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  private getComponentConfig(name: string): ComponentConfig | undefined {
    const components = this.config.components as Record<string, ComponentConfig>;
    return components[name];
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

