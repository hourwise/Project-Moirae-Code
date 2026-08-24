import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIRECRACKER_PROFILE_ID,
  FirecrackerProfileVerifier,
  FirecrackerSupervisor,
  buildFirecrackerLaunchSpec,
  type FirecrackerProfileIo,
  type FirecrackerProfileManifest,
} from './firecracker-profile.js';

const DIGESTS = {
  firecracker: 'a'.repeat(64),
  jailer: 'b'.repeat(64),
  guestKernel: 'c'.repeat(64),
  guestRootfs: 'd'.repeat(64),
  workload: 'e'.repeat(64),
  evidenceCollector: 'f'.repeat(64),
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
    guestCid: 42,
    guestVsockPort: 7000,
    hostVsockSocket: '/run/fates/vsock.sock',
    vcpuCount: 2,
    memoryMiB: 512,
    guestExecutionBinding: { contractVersion: 'fates-guest-init-exec-pinned-v1', workloadId: 'workload.fixed', evidenceCollectorId: 'collector.fixed' },
  };
}

function io(overrides: Partial<FirecrackerProfileIo> = {}): FirecrackerProfileIo {
  return {
    platform: () => 'linux',
    architecture: () => 'x64',
    access: async () => undefined,
    stat: async () => ({ isFile: () => false, isCharacterDevice: () => true }),
    sha256: async (path) => {
      const entry = Object.entries(manifest()).find(([, value]) => value && typeof value === 'object' && 'path' in value && value.path === path);
      return entry && typeof entry[1] === 'object' && entry[1] !== null && 'sha256' in entry[1]
        ? String(entry[1].sha256)
        : '0'.repeat(64);
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

describe('Firecracker launch supervision', () => {
  it('builds a no-NIC jailer command with an explicit bounded guest profile', async () => {
    const checked = await new FirecrackerProfileVerifier(io()).verify(manifest());
    if (!checked.ok) throw new Error(checked.reason);
    const spec = buildFirecrackerLaunchSpec(manifest(), 'fates-session-1', checked.profileDigest);

    expect(spec.jailerArgs).toEqual(expect.arrayContaining(['--exec-file', '/opt/fates/firecracker', '--', '--config-file']));
    expect(spec.jailerArgs.join(' ')).not.toContain('--net');
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
          };
        },
      },
      spawnImpl: () => { spawned = true; throw new Error('must not spawn'); },
    }).start(manifest(), 'fates-session-malicious')).rejects.toThrow('effective config bytes changed');
    expect(spawned).toBe(false);
  });
});
