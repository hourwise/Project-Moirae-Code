/**
 * @moirae/runtime-contracts — Moirae-specific types.
 *
 * These types are internal to the Moirae Code monorepo and do NOT belong in
 * the external project-runtime-contracts repo. They describe Moirae-only
 * concerns: supervisor configuration, packaging manifests, update manifests,
 * extension policies, and desktop distribution metadata.
 */

// ═══════════════════════════════════════════════════════════════
// SUPERVISOR CONFIG
// ═══════════════════════════════════════════════════════════════

export interface SupervisorConfig {
  /** Path to the project/workspace root. */
  projectRoot: string;

  /** Directory for runtime data (SQLite databases, logs, cache). */
  dataDir: string;

  /** Whether to auto-start Fate components on supervisor launch. */
  autoStart: boolean;

  /** Per-component configuration. */
  components: {
    ananke: ComponentConfig;
    mnemosyne: ComponentConfig;
    horae: ComponentConfig;
  };

  /** Health check interval in milliseconds. */
  healthCheckIntervalMs: number;

  /** Maximum restart attempts before entering degraded mode. */
  maxRestartAttempts: number;

  /** Cooldown period between restart attempts (ms). */
  restartCooldownMs: number;

  /** IPC transport configuration. */
  ipc: IpcConfig;

  /** Logging configuration. */
  logging: LoggingConfig;
}

export interface ComponentConfig {
  enabled: boolean;
  port: number;
  /** Command to launch the component. If omitted, supervisor looks for it in PATH. */
  command?: string;
  /** Arguments passed to the command. */
  args?: string[];
  /** Environment variables injected into the component process. */
  env?: Record<string, string>;
  /** Startup timeout before marking as failed. */
  startupTimeoutMs: number;
  /** Health check endpoint path (appended to localhost:port). */
  healthEndpoint: string;
}

export interface IpcConfig {
  /** Transport mechanism. */
  transport: 'stdio' | 'tcp' | 'domain_socket';
  /** Host for TCP transport. */
  host?: string;
  /** Port range for TCP transport. */
  portRange?: { min: number; max: number };
  /** Path for domain socket transport. */
  socketPath?: string;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Directory for log files. */
  directory: string;
  /** Maximum log file size before rotation (bytes). */
  maxFileSizeBytes: number;
  /** Number of rotated log files to keep. */
  maxFiles: number;
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT HEALTH & CRASH RECOVERY
// ═══════════════════════════════════════════════════════════════

export interface ComponentHealth {
  componentId: string;
  status: ComponentHealthStatus;
  pid: number | null;
  port: number;
  uptimeMs: number;
  restartCount: number;
  lastError: string | null;
  lastCheckTime: string;
}

export enum ComponentHealthStatus {
  STARTING = 'starting',
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  CRASHED = 'crashed',
  STOPPED = 'stopped',
  RESTARTING = 'restarting',
}

export interface CrashRecord {
  componentId: string;
  timestamp: string;
  exitCode: number | null;
  signal: string | null;
  stderr: string | null;
  restartAttempt: number;
  recoveryAction: CrashRecoveryAction;
}

export enum CrashRecoveryAction {
  RESTART = 'restart',
  RESTART_WITH_BACKOFF = 'restart_with_backoff',
  DEGRADE = 'degrade',
  STOP_ALL = 'stop_all',
}

// ═══════════════════════════════════════════════════════════════
// PACKAGING
// ═══════════════════════════════════════════════════════════════

export interface PackagingManifest {
  /** Moirae Code version being packaged. */
  version: string;
  /** Target platform. */
  platform: 'windows' | 'linux' | 'macos';
  /** Target architecture. */
  arch: 'x64' | 'arm64';
  /** VSCodium upstream version. */
  vscodiumVersion: string;
  /** Bundled component versions. */
  components: Record<string, string>;
  /** Installer type. */
  installerType: InstallerType;
  /** Code signing configuration. */
  signing: SigningConfig;
  /** Included extensions. */
  extensions: BundledExtension[];
}

export enum InstallerType {
  MSI = 'msi',
  NSIS = 'nsis',
  APP_IMAGE = 'app_image',
  DEB = 'deb',
  DMG = 'dmg',
}

export interface SigningConfig {
  enabled: boolean;
  certificatePath?: string;
  certificatePassword?: string;
  timestampServer?: string;
}

export interface BundledExtension {
  id: string;
  publisher: string;
  version: string;
  hash: string;
  signatureStatus: 'unsigned' | 'signed' | 'verified';
}

// ═══════════════════════════════════════════════════════════════
// UPDATE SERVICE
// ═══════════════════════════════════════════════════════════════

export enum ReleaseChannel {
  STABLE = 'stable',
  BETA = 'beta',
  NIGHTLY = 'nightly',
}

export interface UpdateManifest {
  version: string;
  channel: ReleaseChannel;
  releaseDate: string;
  /** Minimum Moirae version required to install this update. */
  minMoiraeVersion: string;
  /** Download URL for the update package. */
  downloadUrl: string;
  /** SHA-256 hash of the update package. */
  sha256: string;
  /** Cryptographic signature over the manifest. */
  signature: string;
  /** Human-readable release notes. */
  releaseNotes: string;
  /** Size of the update in bytes. */
  sizeBytes: number;
  /** Whether this update requires a restart. */
  requiresRestart: boolean;
}

export interface UpdateStatus {
  currentVersion: string;
  channel: ReleaseChannel;
  latestVersion: string | null;
  updateAvailable: boolean;
  lastChecked: string;
  downloadProgress: number;
  readyToInstall: boolean;
  error: string | null;
}

// ═══════════════════════════════════════════════════════════════
// EXTENSION POLICY
// ═══════════════════════════════════════════════════════════════

export interface ExtensionPolicy {
  /** Allowlist mode: if true, only listed publishers are allowed. */
  allowlistMode: boolean;
  /** Publishers explicitly allowed. */
  allowedPublishers: string[];
  /** Publishers explicitly blocked. */
  blockedPublishers: string[];
  /** Extensions that must have verified signatures. */
  requireSignature: boolean;
  /** Extensions that cannot be installed in protected workspaces. */
  restrictedInProtectedWorkspaces: string[];
  /** Maximum number of extensions allowed. */
  maxExtensions: number;
  /** Whether to quarantine extensions with known vulnerabilities. */
  quarantineOnVulnerability: boolean;
}
