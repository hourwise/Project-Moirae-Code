import { createHash, randomUUID } from 'node:crypto';
import { access, readFile, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { arch } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

const SHA256 = /^[0-9a-f]{64}$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KVM_DEVICE = '/dev/kvm';
const FIRECRACKER_SOCKET = '/run/fates/firecracker.socket';
const FIRECRACKER_CONFIG = '/run/fates/firecracker-config.json';

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
  kvmDevice?: string;
  guestCid: number;
  guestVsockPort: number;
  hostVsockSocket: string;
  vcpuCount: number;
  memoryMiB: number;
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
  config: {
    'boot-source': {
      kernel_image_path: string;
      boot_args: string;
    };
    drives: Array<{
      drive_id: 'rootfs';
      path_on_host: string;
      is_root_device: true;
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

    const artifacts = [
      ['firecracker', manifest.firecracker],
      ['jailer', manifest.jailer],
      ['guest-kernel', manifest.guestKernel],
      ['guest-rootfs', manifest.guestRootfs],
      ['workload', manifest.workload],
      ['evidence-collector', manifest.evidenceCollector],
    ] as const;
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

  const config = {
    'boot-source': {
      kernel_image_path: manifest.guestKernel.path,
      boot_args: 'console=ttyS0 reboot=k panic=1 pci=off',
    },
    drives: [{
      drive_id: 'rootfs' as const,
      path_on_host: manifest.guestRootfs.path,
      is_root_device: true as const,
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
  return {
    sessionId,
    profileDigest,
    jailerPath: manifest.jailer.path,
    firecrackerPath: manifest.firecracker.path,
    jailerArgs: [
      '--id', sessionId,
      '--exec-file', manifest.firecracker.path,
      '--uid', '1000',
      '--gid', '1000',
      '--chroot-base-dir', '/run/fates/jailer',
      '--',
      '--api-sock', FIRECRACKER_SOCKET,
      '--config-file', FIRECRACKER_CONFIG,
      '--level', 'Warning',
    ],
    firecrackerArgs: ['--api-sock', FIRECRACKER_SOCKET, '--config-file', FIRECRACKER_CONFIG, '--level', 'Warning'],
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

  constructor(options: FirecrackerSupervisorOptions = {}) {
    this.verifier = new FirecrackerProfileVerifier(options.io);
    this.spawnImpl = options.spawnImpl ?? ((file, args, spawnOptions) => spawn(file, args, spawnOptions));
    this.killGraceMs = options.killGraceMs ?? 2_000;
    if (!Number.isSafeInteger(this.killGraceMs) || this.killGraceMs <= 0) {
      throw new TypeError('kill grace must be a positive safe integer');
    }
  }

  async start(manifest: FirecrackerProfileManifest, sessionId = `fates-${randomUUID()}`): Promise<FirecrackerSession> {
    const preflight = await this.verifier.verify(manifest);
    if (!preflight.ok) throw new Error(`Firecracker preflight failed: ${preflight.reason}`);
    const spec = buildFirecrackerLaunchSpec(manifest, sessionId, preflight.profileDigest);
    const child = this.spawnImpl(spec.jailerPath, spec.jailerArgs, {
      cwd: '/run/fates',
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
      wait: () => waitPromise,
      stop,
    };
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
