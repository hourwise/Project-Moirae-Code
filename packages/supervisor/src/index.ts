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
 */

export interface ComponentStatus {
  name: string;
  version: string;
  protocolVersion: string;
  healthy: boolean;
  uptimeMs: number;
  pid?: number;
  port?: number;
  warnings: string[];
}

export interface SupervisorConfig {
  projectRoot: string;
  dataDir: string;
  autoStart: boolean;
  components: {
    ananke: { enabled: boolean; port: number; command?: string };
    mnemosyne: { enabled: boolean; port: number; command?: string };
    horae: { enabled: boolean; port: number; command?: string };
  };
}

export class MoiraeSupervisor {
  private components = new Map<string, ComponentStatus>();

  constructor(private config: SupervisorConfig) {}

  /**
   * Start all enabled components. In the Phase 1 prototype, this spawns
   * the Fate processes. Each runs independently with its own SQLite store.
   */
  async start(): Promise<void> {
    // TODO: Spawn Ananke, Mnemosyne, Horae as child processes
    // TODO: Wait for health checks to pass
    console.log('[supervisor] Starting Moirae runtime components...');
  }

  /**
   * Gracefully stop all managed components.
   */
  async stop(): Promise<void> {
    // TODO: Send SIGTERM to child processes, wait, then SIGKILL
    console.log('[supervisor] Stopping all components...');
  }

  /**
   * Returns the health status of all managed components.
   */
  status(): ComponentStatus[] {
    return [...this.components.values()];
  }

  /**
   * Check component version compatibility before starting.
   */
  async checkCompatibility(): Promise<{ compatible: boolean; issues: string[] }> {
    // TODO: Query each component's RuntimeIdentity and compare protocol versions
    return { compatible: true, issues: [] };
  }
}
