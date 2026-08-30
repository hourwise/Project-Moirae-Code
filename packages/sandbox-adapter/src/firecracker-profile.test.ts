import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FATES_005A_PROPOSAL_PROFILE_ID,
  FIRECRACKER_PROFILE_ID,
  Fates005aProposalProfileVerifier,
  FirecrackerProfileVerifier,
  FirecrackerSupervisor,
  buildFirecrackerLaunchSpec,
  buildFates005aProposalLaunchSpec,
  validateFates005aGuestKernelCapabilities,
  type FirecrackerProfileIo,
  type FirecrackerProfileManifest,
  type Fates005aProposalProfileManifest,
} from './firecracker-profile.js';

const DIGESTS = {
  firecracker: 'a'.repeat(64),
  jailer: 'b'.repeat(64),
  guestKernel: 'c'.repeat(64),
  guestRootfs: 'd'.repeat(64),
  workload: 'e'.repeat(64),
  evidenceCollector: 'f'.repeat(64),
  guestInitrd: '1'.repeat(64),
} as const;

function manifest(): FirecrackerProfileManifest {
  return {
    profileId: FIRECRACKER_PROFILE_ID,
    firecracker: { path: '/opt/fates/firecracker', sha256: DIGESTS.firecracker },
    jailer: { path: '/opt/fates/jailer', sha256: DIGESTS.jailer },
    guestKernel: { path: '/opt/fates/guest-kernel', sha256: DIGESTS.guestKernel },
    guestRootfs: { path: '/opt/fates/guest-rootfs.ext4', sha256: DIGESTS.guestRootfs },
    workload: { path: '/opt/fates/workload.squashfs', sha256: DIGESTS.workload },
    evidenceCollector: { path: '/opt/fates/evidence-collector', sha256: DIGESTS.evidenceCollector },
    kvmDevice: '/dev/kvm',
    networkNamespacePath: '/run/netns/fates-test',
    guestCid: 42,
    guestVsockPort: 7000,
    hostVsockSocket: '/run/fates/vsock.sock',
    vcpuCount: 2,
    memoryMiB: 512,
    guestExecutionBinding: { contractVersion: 'fates-guest-init-exec-pinned-v1', workloadId: 'workload.fixed', evidenceCollectorId: 'collector.fixed' },
  };
}

function proposalManifest(): Fates005aProposalProfileManifest {
  return {
    profileId: FATES_005A_PROPOSAL_PROFILE_ID,
    firecracker: { path: '/opt/fates/firecracker', sha256: DIGESTS.firecracker },
    jailer: { path: '/opt/fates/jailer', sha256: DIGESTS.jailer },
    guestKernel: { path: '/opt/fates/guest-kernel', sha256: DIGESTS.guestKernel },
    guestKernelCapabilities: {
      kernelSha256: DIGESTS.guestKernel,
      configSha256: '9'.repeat(64),
      symbols: {
        CONFIG_VSOCKETS: 'y',
        CONFIG_VIRTIO_VSOCKETS: 'y',
        CONFIG_VIRTIO: 'y',
        CONFIG_VIRTIO_MMIO: 'y',
        CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES: 'y',
        CONFIG_BLK_DEV_INITRD: 'y',
        CONFIG_KVM_GUEST: 'y',
        CONFIG_SERIAL_8250_CONSOLE: 'y',
        CONFIG_PRINTK: 'y',
      },
    },
    guestRootfs: { path: '/opt/fates/guest-rootfs.ext4', sha256: DIGESTS.guestRootfs },
    guestInitrd: { path: '/opt/fates/guest-initrd.cpio', sha256: DIGESTS.guestInitrd },
    sessionId: 'fates-005a-001',
    kvmDevice: '/dev/kvm',
    networkNamespacePath: '/run/netns/fates-005a-001',
    guestCid: 42,
    guestVsockPort: 7000,
    hostVsockSocket: '/run/fates/vsock.sock',
    vcpuCount: 1,
    memoryMiB: 256,
    guestProposal: {
      requestId: 'req_fates_005a_001',
      correlationId: 'cor_fates_005a_001',
      sourceId: 'file:docs/fates-005c.md',
      sourceHash: '2'.repeat(64),
      memoryId: 'memory_fates_005c_001',
      idempotencyKey: 'fates-005c-idempotency-001',
    },
  };
}

function io(overrides: Partial<FirecrackerProfileIo> = {}): FirecrackerProfileIo {
  return {
    platform: () => 'linux',
    architecture: () => 'x64',
    access: async () => undefined,
    stat: async () => ({ isFile: () => false, isCharacterDevice: () => true }),
    sha256: async (path) => {
      const entries = [...Object.entries(manifest()), ...Object.entries(proposalManifest())];
      const entry = entries.find(([, value]) => value && typeof value === 'object' && 'path' in value && value.path === path);
      return entry && typeof entry[1] === 'object' && entry[1] !== null && 'sha256' in entry[1] ? String(entry[1].sha256) : '0'.repeat(64);
    },
    ...overrides,
  };
}

describe('Firecracker profile verification', () => {
  it('accepts only the pinned Linux x86_64 no-NIC profile and returns a digest', async () => {
    const result = await new FirecrackerProfileVerifier(io()).verify(manifest());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profileDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.checks.find((check) => check.name === 'no-guest-nic')).toMatchObject({ passed: true });
  });

  it('fails closed before artifact access on unsupported platforms', async () => {
    let hashed = 0;
    const result = await new FirecrackerProfileVerifier(io({
      platform: () => 'win32',
      sha256: async () => {
        hashed += 1;
        return '0'.repeat(64);
      },
    })).verify(manifest());

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('requires Linux') });
    expect(hashed).toBe(0);
  });

  it('rejects digest drift, mutable paths, and a non-fixed vsock endpoint', async () => {
    const drifted = manifest();
    drifted.guestRootfs.sha256 = '0'.repeat(64);
    const digestResult = await new FirecrackerProfileVerifier(io()).verify(drifted);
    expect(digestResult).toMatchObject({ ok: false, reason: expect.stringContaining('guest-rootfs digest') });

    const mutable = manifest();
    mutable.firecracker.path = '/opt/fates/latest/firecracker';
    const mutableResult = await new FirecrackerProfileVerifier(io()).verify(mutable);
    expect(mutableResult).toMatchObject({ ok: false, reason: expect.stringContaining('mutable or placeholder') });

    const endpoint = manifest();
    endpoint.hostVsockSocket = '/run/fates/other.sock';
    const endpointResult = await new FirecrackerProfileVerifier(io()).verify(endpoint);
    expect(endpointResult).toMatchObject({ ok: false, reason: expect.stringContaining('fixed-purpose') });
  });
});

describe('FATES-005A proposal-only profile', () => {
  it('accepts the documented proposal-channel contract without workload or collector drives', async () => {
    const result = await new Fates005aProposalProfileVerifier(io()).verify(proposalManifest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spec = buildFates005aProposalLaunchSpec(proposalManifest(), result.profileDigest);
    expect(result.checks.find((check) => check.name === 'guest-kernel-capabilities')).toMatchObject({ passed: true });
    expect(spec.config.drives).toEqual([{ drive_id: 'rootfs', is_read_only: true, is_root_device: true, path_on_host: '/rootfs' }]);
    expect(spec.config['boot-source'].boot_args).toContain('fates.execution_contract=fates-005a-proposal-channel-v1');
    expect(spec.config['boot-source'].boot_args).not.toContain('fates.workload=');
    expect(spec.config['boot-source'].boot_args).not.toContain('fates.evidence_collector=');
    expect(spec.config).not.toHaveProperty('network-interfaces');
  });

  it('fails closed when a proposal profile tries to add a workload binding', async () => {
    const candidate = proposalManifest() as Fates005aProposalProfileManifest & { workload?: unknown };
    candidate.workload = { path: '/opt/fates/workload.squashfs', sha256: DIGESTS.workload };
    const result = await new Fates005aProposalProfileVerifier(io()).verify(candidate);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('cannot carry workload') });
  });

  it('fails closed when the certified guest kernel capability record is missing, unbound, or modular', () => {
    const missing = proposalManifest() as Fates005aProposalProfileManifest & { guestKernelCapabilities?: unknown };
    delete missing.guestKernelCapabilities;
    expect(validateFates005aGuestKernelCapabilities(missing)).toMatchObject({ ok: false, reason: expect.stringContaining('missing') });

    const unbound = proposalManifest();
    unbound.guestKernelCapabilities.kernelSha256 = '8'.repeat(64);
    expect(validateFates005aGuestKernelCapabilities(unbound)).toMatchObject({ ok: false, reason: expect.stringContaining('not bound') });

    const modular = proposalManifest();
    modular.guestKernelCapabilities.symbols.CONFIG_VIRTIO_VSOCKETS = 'm' as never;
    expect(validateFates005aGuestKernelCapabilities(modular)).toMatchObject({ ok: false, reason: expect.stringContaining('CONFIG_VIRTIO_VSOCKETS=y') });
  });
});

describe('Firecracker launch supervision', () => {
  it('builds a no-NIC jailer command with an explicit bounded guest profile', async () => {
    const checked = await new FirecrackerProfileVerifier(io()).verify(manifest());
    if (!checked.ok) throw new Error(checked.reason);
    const spec = buildFirecrackerLaunchSpec(manifest(), 'fates-session-1', checked.profileDigest);

    expect(spec.jailerArgs).toEqual(expect.arrayContaining(['--exec-file', '/opt/fates/firecracker', '--', '--config-file']));
    expect(spec.jailerArgs).toEqual(expect.arrayContaining(['--netns', '/run/netns/fates-test']));
    expect(spec.config).toMatchObject({
      'machine-config': { vcpu_count: 2, mem_size_mib: 512, smt: false },
      vsock: { guest_cid: 42, uds_path: '/run/fates/vsock.sock' },
    });
    expect(spec.config).not.toHaveProperty('network-interfaces');
    expect(spec.config.drives).toEqual(expect.arrayContaining([
      expect.objectContaining({ drive_id: 'workload', path_on_host: '/workload', is_read_only: true }),
      expect.objectContaining({ drive_id: 'evidence-collector', path_on_host: '/evidence-collector', is_read_only: true }),
    ]));
    expect(createHash('sha256').update(spec.effectiveConfigJson, 'utf8').digest('hex')).toBe(spec.effectiveConfigSha256);
    expect(JSON.parse(spec.effectiveConfigJson)).not.toHaveProperty('network-interfaces');
  });

  it('owns shutdown and escalates to SIGKILL when the VMM does not exit', async () => {
    const child = new EventEmitter() as EventEmitter & { pid: number; kill: (signal: NodeJS.Signals) => boolean };
    child.pid = 901;
    child.kill = (signal) => {
      if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
      return true;
    };
    const signals: NodeJS.Signals[] = [];
    const session = await new FirecrackerSupervisor({
      io: io(),
      killGraceMs: 1,
      stager: {
        stage: async (_manifest, spec) => {
          const sessionRuntimeDir = await mkdtemp(join(tmpdir(), 'fates-firecracker-'));
          const effectiveConfigPath = join(sessionRuntimeDir, 'firecracker-config.json');
          await writeFile(effectiveConfigPath, spec.effectiveConfigJson, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          return {
            sessionRuntimeDir,
            effectiveConfigPath,
            effectiveConfigSha256: spec.effectiveConfigSha256,
            stagedArtifactDigests: {
              guestKernel: DIGESTS.guestKernel,
              guestRootfs: DIGESTS.guestRootfs,
              workload: DIGESTS.workload,
              evidenceCollector: DIGESTS.evidenceCollector,
            },
            jailRootPath: sessionRuntimeDir,
            hostVsockSocketPath: '/run/fates/vsock.sock',
            guestVsockSocketPath: '/run/fates/vsock.sock_7000',
          };
        },
      },
      spawnImpl: (_file, _args, _options) => {
        const process = child as unknown as import('node:child_process').ChildProcess;
        const originalKill = child.kill;
        child.kill = (signal) => {
          signals.push(signal);
          return originalKill(signal);
        };
        return process;
      },
    }).start(manifest(), 'fates-session-2');

    expect(session.pid).toBe(901);
    await session.stop('test cleanup');
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    await expect(session.wait()).resolves.toEqual({ exitCode: null, signal: 'SIGKILL' });
    expect(session.effectiveConfigSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(session.jailerPid).toBe(session.pid);
  });

  it('refuses a malicious or ambient effective config before jailer spawn', async () => {
    let spawned = false;
    await expect(new FirecrackerSupervisor({
      io: io(),
      stager: {
        stage: async (_manifest, spec) => {
          const sessionRuntimeDir = await mkdtemp(join(tmpdir(), 'fates-firecracker-malicious-'));
          const effectiveConfigPath = join(sessionRuntimeDir, 'firecracker-config.json');
          const malicious = JSON.stringify({ ...JSON.parse(spec.effectiveConfigJson), 'network-interfaces': [{ iface_id: 'eth0' }] });
          await writeFile(effectiveConfigPath, malicious, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          return {
            sessionRuntimeDir,
            effectiveConfigPath,
            effectiveConfigSha256: spec.effectiveConfigSha256,
            stagedArtifactDigests: { guestKernel: DIGESTS.guestKernel, guestRootfs: DIGESTS.guestRootfs, workload: DIGESTS.workload, evidenceCollector: DIGESTS.evidenceCollector },
            jailRootPath: sessionRuntimeDir,
            hostVsockSocketPath: '/run/fates/vsock.sock',
            guestVsockSocketPath: '/run/fates/vsock.sock_7000',
          };
        },
      },
      spawnImpl: () => { spawned = true; throw new Error('must not spawn'); },
    }).start(manifest(), 'fates-session-malicious')).rejects.toThrow('effective config bytes changed');
    expect(spawned).toBe(false);
  });
});
