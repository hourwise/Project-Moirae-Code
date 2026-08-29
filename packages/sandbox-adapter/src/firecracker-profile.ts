import { createHash, randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, open, readFile, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { arch } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';

const SHA256 = /^[0-9a-f]{64}$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KVM_DEVICE = '/dev/kvm';
const JAILER_BASE_DIR = '/srv/jailer';
const SESSION_BASE_DIR = '/run/fates/sessions';
const JAIL_FIRECRACKER_SOCKET = '/firecracker.socket';
const JAIL_FIRECRACKER_CONFIG = '/firecracker-config.json';
const DEFAULT_JAILER_UID = 65532;
const DEFAULT_JAILER_GID = 65532;

export const FIRECRACKER_PROFILE_ID =
  'linux-x86_64-kvm-firecracker-no-nic-constrained-vsock-v1' as const;

export interface PinnedArtifact {
  path: string;
  sha256: string;
}

export interface FirecrackerProfileManifest {
  profileId: typeof FIRECRACKER_PROFILE_ID;
  firecracker: PinnedArtifact;
  jailer: PinnedArtifact;
  guestKernel: PinnedArtifact;
  guestRootfs: PinnedArtifact;
  workload: PinnedArtifact;
  evidenceCollector: PinnedArtifact;
  /** A fresh initrd containing the guest-side fixed-purpose proposal agent. */
  guestInitrd?: PinnedArtifact;
  kvmDevice?: string;
  /** A pre-created, empty network namespace handle passed to jailer --netns. */
  networkNamespacePath?: string;
  jailerChrootBaseDir?: string;
  guestCid: number;
  guestVsockPort: number;
  hostVsockSocket: string;
  vcpuCount: number;
  memoryMiB: number;
  jailerUid?: number;
  jailerGid?: number;
  guestExecutionBinding?: {
    contractVersion: 'fates-guest-init-exec-pinned-v1';
    workloadId: string;
    evidenceCollectorId: string;
  };
  guestProposal?: {
    requestId: string;
    correlationId: string;
    sourceId: string;
    sourceHash: string;
    memoryId: string;
    idempotencyKey: string;
  };
}

export interface FirecrackerPreflightCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface FirecrackerPreflightPassed {
  ok: true;
  profileDigest: string;
  checks: FirecrackerPreflightCheck[];
}

export interface FirecrackerPreflightFailed {
  ok: false;
  reason: string;
  checks: FirecrackerPreflightCheck[];
}

export type FirecrackerPreflight = FirecrackerPreflightPassed | FirecrackerPreflightFailed;

export interface FirecrackerLaunchSpec {
  sessionId: string;
  profileDigest: string;
  jailerPath: string;
  firecrackerPath: string;
  jailerArgs: string[];
  firecrackerArgs: string[];
  effectiveConfigJson: string;
  effectiveConfigSha256: string;
  stagedArtifactNames: readonly ('guestKernel' | 'guestRootfs' | 'workload' | 'evidenceCollector' | 'guestInitrd')[];
  config: {
    'boot-source': {
      kernel_image_path: string;
      initrd_path?: string;
      boot_args: string;
    };
    drives: Array<{
      drive_id: 'rootfs' | 'workload' | 'evidence-collector';
      path_on_host: string;
      is_root_device: boolean;
      is_read_only: true;
    }>;
    'machine-config': {
      vcpu_count: number;
      mem_size_mib: number;
      smt: false;
    };
    vsock: {
      guest_cid: number;
      uds_path: string;
    };
  };
}

export interface FirecrackerStagedSession {
  sessionRuntimeDir: string;
  effectiveConfigPath: string;
  effectiveConfigSha256: string;
  stagedArtifactDigests: Partial<Record<'guestKernel' | 'guestRootfs' | 'workload' | 'evidenceCollector' | 'guestInitrd', string>> & Record<'guestKernel' | 'guestRootfs' | 'workload' | 'evidenceCollector', string>;
  jailRootPath: string;
  hostVsockSocketPath: string;
  guestVsockSocketPath: string;
}

export interface FirecrackerSessionStager {
  stage(manifest: FirecrackerProfileManifest, spec: FirecrackerLaunchSpec): Promise<FirecrackerStagedSession>;
}

export interface FirecrackerProfileIo {
  platform?: () => NodeJS.Platform;
  architecture?: () => string;
  access?: (path: string, mode?: number) => Promise<void>;
  stat?: (path: string) => Promise<{ isFile(): boolean; isCharacterDevice(): boolean }>;
  sha256?: (path: string) => Promise<string>;
}

export interface FirecrackerSession {
  readonly sessionId: string;
  readonly profileDigest: string;
  readonly pid: number;
  readonly jailerPid: number;
  readonly effectiveConfigSha256: string;
  readonly stagedArtifactDigests: FirecrackerStagedSession['stagedArtifactDigests'];
  readonly jailRootPath: string;
  /** Actual host-visible UDS path backing the guest AF_VSOCK endpoint. */
  readonly hostVsockSocketPath: string;
  /** Actual host listener path used when the guest initiates on guestVsockPort. */
  readonly guestVsockSocketPath: string;
  readonly networkNamespacePath: string;
  wait(): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  stop(reason?: string): Promise<void>;
}

export interface FirecrackerSpawn {
  (file: string, args: string[], options: SpawnOptions): ChildProcess;
}

export interface FirecrackerSupervisorOptions {
  io?: FirecrackerProfileIo;
  spawnImpl?: FirecrackerSpawn;
  killGraceMs?: number;
  stager?: FirecrackerSessionStager;
}

/**
 * Verifies the selected containment profile before any VMM process is started.
 * The verifier is deliberately independent of SandboxAdapter's risk policy:
 * a valid schema or a product-selected "microVM" mode is not platform proof.
 */
export class FirecrackerProfileVerifier {
  private readonly io: Required<FirecrackerProfileIo>;

  constructor(io: FirecrackerProfileIo = {}) {
    this.io = {
      platform: io.platform ?? (() => process.platform),
      architecture: io.architecture ?? (() => arch()),
      access: io.access ?? access,
      stat: io.stat ?? stat,
      sha256: io.sha256 ?? sha256File,
    };
  }

  async verify(manifest: FirecrackerProfileManifest): Promise<FirecrackerPreflight> {
    const checks: FirecrackerPreflightCheck[] = [];
    const fail = (name: string, detail: string): FirecrackerPreflightFailed => {
      checks.push({ name, passed: false, detail });
      return { ok: false, reason: detail, checks };
    };

    if (manifest.profileId !== FIRECRACKER_PROFILE_ID) {
      return fail('profile-id', 'unsupported Firecracker containment profile');
    }
    checks.push({ name: 'profile-id', passed: true, detail: FIRECRACKER_PROFILE_ID });

    if (this.io.platform() !== 'linux') {
      return fail('platform', 'Firecracker containment requires Linux; no fallback is permitted');
    }
    checks.push({ name: 'platform', passed: true, detail: 'linux' });

    if (this.io.architecture() !== 'x64') {
      return fail('architecture', 'Firecracker containment requires x86_64; no fallback is permitted');
    }
    checks.push({ name: 'architecture', passed: true, detail: 'x86_64' });

    const kvmPath = manifest.kvmDevice ?? KVM_DEVICE;
    if (!isAbsolute(kvmPath)) return fail('kvm-path', 'KVM device path must be absolute');
    try {
      await this.io.access(kvmPath, fsConstants.R_OK | fsConstants.W_OK);
      const kvm = await this.io.stat(kvmPath);
      if (!kvm.isCharacterDevice()) return fail('kvm-device', `${kvmPath} is not a character device`);
      checks.push({ name: 'kvm-device', passed: true, detail: kvmPath });
    } catch {
      return fail('kvm-device', `KVM device is unavailable or inaccessible: ${kvmPath}`);
    }

    const artifacts: Array<[string, PinnedArtifact]> = [
      ['firecracker', manifest.firecracker],
      ['jailer', manifest.jailer],
      ['guest-kernel', manifest.guestKernel],
      ['guest-rootfs', manifest.guestRootfs],
      ['workload', manifest.workload],
      ['evidence-collector', manifest.evidenceCollector],
    ];
    if (manifest.guestInitrd) artifacts.push(['guest-initrd', manifest.guestInitrd]);
    const seenPaths = new Set<string>();
    for (const [name, artifact] of artifacts) {
      if (!isAbsolute(artifact.path)) return fail(`${name}-path`, `${name} path must be absolute`);
      const normalized = resolve(artifact.path);
      if (seenPaths.has(normalized)) return fail(`${name}-path`, `${name} path is duplicated`);
      seenPaths.add(normalized);
      if (!SHA256.test(artifact.sha256)) return fail(`${name}-digest`, `${name} SHA-256 must be lowercase hex`);
      if (/latest|placeholder|example|changeme/i.test(artifact.path)) {
        return fail(`${name}-path`, `${name} path contains a mutable or placeholder reference`);
      }
      try {
        const actual = await this.io.sha256(artifact.path);
        if (actual !== artifact.sha256) return fail(`${name}-digest`, `${name} digest does not match the pinned artifact`);
        checks.push({ name: `${name}-digest`, passed: true, detail: artifact.sha256 });
      } catch {
        return fail(`${name}-artifact`, `${name} artifact is unavailable: ${artifact.path}`);
      }
    }

    const networkNamespacePath = manifest.networkNamespacePath;
    if (!networkNamespacePath || !isAbsolute(networkNamespacePath) || networkNamespacePath.includes('..') || !networkNamespacePath.startsWith('/run/netns/')) {
      return fail('network-namespace', 'a dedicated /run/netns namespace handle is required for Firecracker launch');
    }
    try {
      await this.io.access(networkNamespacePath, fsConstants.R_OK);
      checks.push({ name: 'network-namespace', passed: true, detail: networkNamespacePath });
    } catch {
      return fail('network-namespace', `network namespace handle is unavailable: ${networkNamespacePath}`);
    }

    if (!Number.isSafeInteger(manifest.guestCid) || manifest.guestCid < 3 || manifest.guestCid > 2 ** 32 - 1) {
      return fail('guest-cid', 'guest CID must be a safe integer greater than 2');
    }
    if (!Number.isSafeInteger(manifest.guestVsockPort) || manifest.guestVsockPort < 1 || manifest.guestVsockPort > 2 ** 32 - 1) {
      return fail('guest-vsock-port', 'guest vsock port must be a safe positive integer');
    }
    if (!isAbsolute(manifest.hostVsockSocket) || manifest.hostVsockSocket.includes('..')) {
      return fail('vsock-socket', 'host vsock socket must be an absolute non-traversing path');
    }
    if (manifest.hostVsockSocket !== '/run/fates/vsock.sock') {
      return fail('vsock-socket', 'host vsock socket must use the fixed-purpose Fates endpoint');
    }
    if (!Number.isSafeInteger(manifest.vcpuCount) || manifest.vcpuCount < 1 || manifest.vcpuCount > 32) {
      return fail('vcpu-count', 'vcpu count is outside the bounded profile');
    }
    if (!Number.isSafeInteger(manifest.memoryMiB) || manifest.memoryMiB < 128 || manifest.memoryMiB > 65_536) {
      return fail('memory', 'memory limit is outside the bounded profile');
    }
    const jailerUid = manifest.jailerUid ?? DEFAULT_JAILER_UID;
    const jailerGid = manifest.jailerGid ?? DEFAULT_JAILER_GID;
    if (!Number.isSafeInteger(jailerUid) || jailerUid <= 0 || jailerUid === 1000 || !Number.isSafeInteger(jailerGid) || jailerGid <= 0 || jailerGid === 1000) {
      return fail('jailer-identity', 'jailer must run as a dedicated non-interactive UID/GID');
    }
    if (!manifest.guestExecutionBinding) {
      return fail('guest-execution-binding', 'pinned workload/evidence artifacts have no declared guest init execution binding');
    }
    checks.push({ name: 'jailer-identity', passed: true, detail: `${jailerUid}:${jailerGid}` });
    checks.push({ name: 'guest-execution-binding', passed: true, detail: manifest.guestExecutionBinding.contractVersion });
    checks.push({ name: 'no-guest-nic', passed: true, detail: 'network interfaces are omitted from the VM configuration' });
    checks.push({ name: 'bounded-resources', passed: true, detail: `${manifest.vcpuCount} vCPU / ${manifest.memoryMiB} MiB` });

    const profileDigest = digestManifest(manifest);
    checks.push({ name: 'profile-digest', passed: true, detail: profileDigest });
    return { ok: true, profileDigest, checks };
  }
}

export function digestManifest(manifest: FirecrackerProfileManifest): string {
  return createHash('sha256').update(canonicalJson(manifest)).digest('hex');
}

export function buildFirecrackerLaunchSpec(
  manifest: FirecrackerProfileManifest,
  sessionId: string,
  profileDigest: string,
): FirecrackerLaunchSpec {
  if (!SESSION_ID.test(sessionId)) throw new TypeError('session ID is malformed');
  if (!SHA256.test(profileDigest)) throw new TypeError('profile digest is malformed');
  if (manifest.hostVsockSocket !== '/run/fates/vsock.sock') {
    throw new TypeError('profile does not use the fixed-purpose Fates vsock endpoint');
  }
  if (!manifest.guestExecutionBinding) throw new TypeError('profile lacks a guest workload/evidence execution binding');
  if (!manifest.networkNamespacePath || !manifest.networkNamespacePath.startsWith('/run/netns/') || manifest.networkNamespacePath.includes('..')) {
    throw new TypeError('profile lacks a dedicated network namespace handle');
  }
  const guestInitrd = manifest.guestInitrd;
  if (Boolean(guestInitrd) !== Boolean(manifest.guestProposal)) {
    throw new TypeError('guest initrd and guest proposal binding must be supplied together');
  }
  if (manifest.guestProposal) {
    const allowedGuestProposalFields = new Set(['requestId', 'correlationId', 'sourceId', 'sourceHash', 'memoryId', 'idempotencyKey']);
    if (Object.keys(manifest.guestProposal).some((name) => !allowedGuestProposalFields.has(name)) || Object.keys(manifest.guestProposal).length !== allowedGuestProposalFields.size) {
      throw new TypeError('guest proposal contains unsupported fields');
    }
    for (const [name, value] of Object.entries(manifest.guestProposal)) {
      const valid = name === 'sourceId'
        ? typeof value === 'string' && /^file:[A-Za-z0-9._/-]{1,240}$/.test(value) && !value.includes('..')
        : typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value);
      if (!valid) throw new TypeError(`guest proposal ${name} is malformed`);
    }
    if (!SHA256.test(manifest.guestProposal.sourceHash)) throw new TypeError('guest proposal source hash is malformed');
  }

  const config = {
    'boot-source': {
      kernel_image_path: '/kernel',
      ...(guestInitrd ? { initrd_path: '/guest-initrd' } : {}),
      boot_args: [
        'console=ttyS0',
        'reboot=k',
        'panic=1',
        'pci=off',
        `fates.execution_contract=${manifest.guestExecutionBinding.contractVersion}`,
        'fates.workload=/workload',
        'fates.evidence_collector=/evidence-collector',
        ...(manifest.guestProposal ? [
          `fates.vsock_port=${manifest.guestVsockPort}`,
          `fates.session=${sessionId}`,
          `fates.request_id=${manifest.guestProposal.requestId}`,
          `fates.correlation_id=${manifest.guestProposal.correlationId}`,
          `fates.source_id=${manifest.guestProposal.sourceId}`,
          `fates.source_hash=${manifest.guestProposal.sourceHash}`,
          `fates.memory_id=${manifest.guestProposal.memoryId}`,
          `fates.idempotency_key=${manifest.guestProposal.idempotencyKey}`,
        ] : []),
      ].join(' '),
    },
    drives: [{
      drive_id: 'rootfs' as const,
      path_on_host: '/rootfs',
      is_root_device: true as const,
      is_read_only: true as const,
    }, {
      drive_id: 'workload' as const,
      path_on_host: '/workload',
      is_root_device: false as const,
      is_read_only: true as const,
    }, {
      drive_id: 'evidence-collector' as const,
      path_on_host: '/evidence-collector',
      is_root_device: false as const,
      is_read_only: true as const,
    }],
    'machine-config': {
      vcpu_count: manifest.vcpuCount,
      mem_size_mib: manifest.memoryMiB,
      smt: false as const,
    },
    vsock: {
      guest_cid: manifest.guestCid,
      uds_path: manifest.hostVsockSocket,
    },
  };
  const effectiveConfigJson = canonicalJson(config);
  return {
    sessionId,
    profileDigest,
    jailerPath: manifest.jailer.path,
    firecrackerPath: manifest.firecracker.path,
    effectiveConfigJson,
    effectiveConfigSha256: createHash('sha256').update(effectiveConfigJson, 'utf8').digest('hex'),
    stagedArtifactNames: [
      'guestKernel',
      'guestRootfs',
      'workload',
      'evidenceCollector',
      ...(guestInitrd ? ['guestInitrd' as const] : []),
    ],
    jailerArgs: [
      '--id', sessionId,
      '--exec-file', manifest.firecracker.path,
      '--uid', String(manifest.jailerUid ?? DEFAULT_JAILER_UID),
      '--gid', String(manifest.jailerGid ?? DEFAULT_JAILER_GID),
      '--chroot-base-dir', manifest.jailerChrootBaseDir ?? JAILER_BASE_DIR,
      '--netns', manifest.networkNamespacePath,
      '--new-pid-ns',
      '--resource-limit', 'no-file=1024',
      '--',
      '--api-sock', JAIL_FIRECRACKER_SOCKET,
      '--config-file', JAIL_FIRECRACKER_CONFIG,
      '--level', 'Warning',
    ],
    firecrackerArgs: ['--api-sock', JAIL_FIRECRACKER_SOCKET, '--config-file', JAIL_FIRECRACKER_CONFIG, '--level', 'Warning'],
    config,
  };
}

/**
 * Owns only the host-side VMM process. It does not interpret guest messages,
 * mint authority, or provide a host-process fallback. Guest execution and the
 * authenticated fixed-purpose channel are intentionally separate milestones.
 */
export class FirecrackerSupervisor {
  private readonly verifier: FirecrackerProfileVerifier;
  private readonly spawnImpl: FirecrackerSpawn;
  private readonly killGraceMs: number;
  private readonly stager: FirecrackerSessionStager;

  constructor(options: FirecrackerSupervisorOptions = {}) {
    this.verifier = new FirecrackerProfileVerifier(options.io);
    this.spawnImpl = options.spawnImpl ?? ((file, args, spawnOptions) => spawn(file, args, spawnOptions));
    this.killGraceMs = options.killGraceMs ?? 2_000;
    this.stager = options.stager ?? new DefaultFirecrackerSessionStager();
    if (!Number.isSafeInteger(this.killGraceMs) || this.killGraceMs <= 0) {
      throw new TypeError('kill grace must be a positive safe integer');
    }
  }

  async start(manifest: FirecrackerProfileManifest, sessionId = `fates-${randomUUID()}`): Promise<FirecrackerSession> {
    const preflight = await this.verifier.verify(manifest);
    if (!preflight.ok) throw new Error(`Firecracker preflight failed: ${preflight.reason}`);
    const spec = buildFirecrackerLaunchSpec(manifest, sessionId, preflight.profileDigest);
    const staged = await this.stager.stage(manifest, spec);
    if (staged.effectiveConfigSha256 !== spec.effectiveConfigSha256) throw new Error('Firecracker effective config digest mismatch before launch');
    const exactConfig = await readFile(staged.effectiveConfigPath, 'utf8');
    const exactConfigSha256 = createHash('sha256').update(exactConfig, 'utf8').digest('hex');
    if (exactConfigSha256 !== spec.effectiveConfigSha256 || exactConfig !== spec.effectiveConfigJson) throw new Error('Firecracker effective config bytes changed before launch');
    for (const name of spec.stagedArtifactNames) {
      const expectedArtifact = name === 'guestInitrd' ? manifest.guestInitrd : manifest[name];
      if (!expectedArtifact || staged.stagedArtifactDigests[name] !== expectedArtifact.sha256) throw new Error(`Firecracker staged ${name} digest mismatch before launch`);
    }
    const child = this.spawnImpl(spec.jailerPath, spec.jailerArgs, {
      cwd: staged.sessionRuntimeDir,
      env: { PATH: '/usr/bin:/bin' },
      detached: false,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!child.pid) throw new Error('Firecracker jailer did not expose a process identity');

    let settled = false;
    const waitPromise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolveWait, rejectWait) => {
      child.once('error', rejectWait);
      child.once('close', (exitCode, signal) => {
        settled = true;
        resolveWait({ exitCode, signal });
      });
    });
    const stop = async (reason = 'supervisor stop'): Promise<void> => {
      if (settled) return;
      child.kill('SIGTERM');
      await Promise.race([
        waitPromise,
        new Promise<void>((resolveWait) => setTimeout(resolveWait, this.killGraceMs)),
      ]);
      if (!settled) {
        child.kill('SIGKILL');
        await waitPromise;
      }
      void reason;
    };
    return {
      sessionId,
      profileDigest: preflight.profileDigest,
      pid: child.pid,
      jailerPid: child.pid,
      effectiveConfigSha256: spec.effectiveConfigSha256,
      stagedArtifactDigests: staged.stagedArtifactDigests,
      jailRootPath: staged.jailRootPath,
      hostVsockSocketPath: staged.hostVsockSocketPath,
      guestVsockSocketPath: staged.guestVsockSocketPath,
      networkNamespacePath: manifest.networkNamespacePath!,
      wait: () => waitPromise,
      stop,
    };
  }
}

class DefaultFirecrackerSessionStager implements FirecrackerSessionStager {
  async stage(manifest: FirecrackerProfileManifest, spec: FirecrackerLaunchSpec): Promise<FirecrackerStagedSession> {
    const sessionRuntimeDir = join(SESSION_BASE_DIR, spec.sessionId);
    const jailerBaseDir = manifest.jailerChrootBaseDir ?? JAILER_BASE_DIR;
    const jailSessionDir = join(jailerBaseDir, basename(spec.firecrackerPath), spec.sessionId);
    const jailRoot = join(jailSessionDir, 'root');
    await mkdir(SESSION_BASE_DIR, { recursive: true, mode: 0o700 });
    await mkdir(jailerBaseDir, { recursive: true, mode: 0o700 });
    await mkdir(sessionRuntimeDir, { recursive: false, mode: 0o700 });
    await mkdir(jailSessionDir, { recursive: true, mode: 0o700 });
    await mkdir(jailRoot, { recursive: true, mode: 0o700 });
    await mkdir(join(jailRoot, 'run', 'fates'), { recursive: true, mode: 0o755 });
    const artifacts = {
      guestKernel: { source: manifest.guestKernel.path, target: join(jailRoot, 'kernel'), digest: manifest.guestKernel.sha256 },
      guestRootfs: { source: manifest.guestRootfs.path, target: join(jailRoot, 'rootfs'), digest: manifest.guestRootfs.sha256 },
      workload: { source: manifest.workload.path, target: join(jailRoot, 'workload'), digest: manifest.workload.sha256 },
      evidenceCollector: { source: manifest.evidenceCollector.path, target: join(jailRoot, 'evidence-collector'), digest: manifest.evidenceCollector.sha256 },
      ...(manifest.guestInitrd ? { guestInitrd: { source: manifest.guestInitrd.path, target: join(jailRoot, 'guest-initrd'), digest: manifest.guestInitrd.sha256 } } : {}),
    } as const;
    const stagedArtifactDigests = {} as FirecrackerStagedSession['stagedArtifactDigests'];
    for (const [name, artifact] of Object.entries(artifacts) as Array<[keyof typeof artifacts, (typeof artifacts)[keyof typeof artifacts]]>) {
      if (!artifact) throw new Error(`Firecracker staged ${name} artifact is missing`);
      await copyFile(artifact.source, artifact.target);
      const actual = await sha256File(artifact.target);
      if (actual !== artifact.digest) throw new Error(`Firecracker staged ${name} digest mismatch`);
      stagedArtifactDigests[name] = actual;
    }
    const effectiveConfigPath = join(jailRoot, 'firecracker-config.json');
    const handle = await open(effectiveConfigPath, 'wx', 0o600);
    try {
      await handle.write(spec.effectiveConfigJson, 0, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    const effectiveConfigSha256 = createHash('sha256').update(await readFile(effectiveConfigPath)).digest('hex');
    if (effectiveConfigSha256 !== spec.effectiveConfigSha256) throw new Error('Firecracker staged config digest mismatch');
    const hostVsockSocketPath = join(jailRoot, manifest.hostVsockSocket.replace(/^\/+/, ''));
    const guestVsockSocketPath = `${hostVsockSocketPath}_${manifest.guestVsockPort}`;
    return { sessionRuntimeDir, effectiveConfigPath, effectiveConfigSha256, stagedArtifactDigests, jailRootPath: jailRoot, hostVsockSocketPath, guestVsockSocketPath };
  }
}

async function sha256File(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new TypeError('manifest contains an unsupported value');
}
