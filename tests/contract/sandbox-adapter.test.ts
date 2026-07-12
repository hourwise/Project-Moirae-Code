/**
 * Contract Tests — @moirae/sandbox-adapter
 *
 * Verifies sandbox mode selection, config validation, approval preview
 * construction, network/path checks, and evidence capture contracts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SandboxAdapter,
  ExecutionMode,
  SandboxOutcome,
  SandboxConfigSchema,
} from '@moirae/sandbox-adapter';
import { RiskClass } from '@moirae/tool-sdk';

describe('SandboxAdapter — Mode Selection', () => {
  const adapter = new SandboxAdapter();

  it('selects RestrictedProcess for READ_ONLY', () => {
    expect(adapter.selectMode(RiskClass.READ_ONLY)).toBe(ExecutionMode.RestrictedProcess);
  });

  it('selects Container for EXTERNAL_SEND and DELETE', () => {
    expect(adapter.selectMode(RiskClass.EXTERNAL_SEND)).toBe(ExecutionMode.Container);
    expect(adapter.selectMode(RiskClass.DELETE)).toBe(ExecutionMode.Container);
  });

  it('selects MicroVM for PAYMENT and PERMISSION_CHANGE', () => {
    expect(adapter.selectMode(RiskClass.PAYMENT)).toBe(ExecutionMode.MicroVM);
    expect(adapter.selectMode(RiskClass.PERMISSION_CHANGE)).toBe(ExecutionMode.MicroVM);
  });

  it('selects RemoteSandbox for DEPLOYMENT', () => {
    expect(adapter.selectMode(RiskClass.DEPLOYMENT)).toBe(ExecutionMode.RemoteSandbox);
  });

  it('selects Container for UNKNOWN (safe default)', () => {
    expect(adapter.selectMode(RiskClass.UNKNOWN)).toBe(ExecutionMode.Container);
  });
});

describe('SandboxAdapter — Config Building', () => {
  const adapter = new SandboxAdapter();

  it('builds a valid default config for READ_ONLY', () => {
    const config = adapter.buildDefaultConfig(RiskClass.READ_ONLY, '/workspace', 'git', ['status']);
    expect(config.mode).toBe(ExecutionMode.RestrictedProcess);
    expect(config.maxDurationMs).toBe(60_000);
    expect(config.networkPolicy).toBe('loopback_only');
    expect(config.allowChildProcesses).toBe(true);
    expect(config.secretsPolicy).toBe('none');
  });

  it('builds a valid default config for DEPLOYMENT', () => {
    const config = adapter.buildDefaultConfig(RiskClass.DEPLOYMENT, '/workspace', 'kubectl', ['apply', '-f', 'deploy.yaml']);
    expect(config.mode).toBe(ExecutionMode.RemoteSandbox);
    expect(config.maxDurationMs).toBe(300_000);
    expect(config.networkPolicy).toBe('blocked');
    expect(config.allowChildProcesses).toBe(false);
  });

  it('config passes schema validation', () => {
    const config = adapter.buildDefaultConfig(RiskClass.INTERNAL_WRITE, '/workspace', 'npm', ['test']);
    const parsed = SandboxConfigSchema.safeParse(config);
    expect(parsed.success).toBe(true);
  });
});

describe('SandboxAdapter — Validation', () => {
  const adapter = new SandboxAdapter();

  it('validates a correct config', () => {
    const config = adapter.buildDefaultConfig(RiskClass.INTERNAL_WRITE, '/workspace', 'npm', ['test']);
    const result = adapter.validate(config, RiskClass.INTERNAL_WRITE);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects mode weaker than required for risk class', () => {
    const config = adapter.buildDefaultConfig(RiskClass.READ_ONLY, '/workspace', 'ls', []);
    // Override to Host mode but keep PAYMENT risk
    const weakConfig = { ...config, mode: ExecutionMode.Host };
    const result = adapter.validate(weakConfig, RiskClass.PAYMENT);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('weaker'))).toBe(true);
  });

  it('rejects network enabled for PAYMENT', () => {
    const config = adapter.buildDefaultConfig(RiskClass.PAYMENT, '/workspace', 'charge', ['--amount=10']);
    const badConfig = { ...config, networkPolicy: 'approved_domains' as const, allowedDomains: ['api.example.com'] };
    const result = adapter.validate(badConfig, RiskClass.PAYMENT);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Network must be blocked'))).toBe(true);
  });

  it('rejects secrets in Host mode', () => {
    const config = adapter.buildDefaultConfig(RiskClass.READ_ONLY, '/workspace', 'cat', ['file.txt']);
    const badConfig = { ...config, mode: ExecutionMode.Host, secretsPolicy: 'all' as const };
    const result = adapter.validate(badConfig, RiskClass.READ_ONLY);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Secrets must not be exposed'))).toBe(true);
  });

  it('rejects credential-like environment variables', () => {
    const config = adapter.buildDefaultConfig(RiskClass.READ_ONLY, '/workspace', 'env', []);
    const badConfig = { ...config, environmentAllowlist: ['PATH', 'API_KEY', 'HOME'] };
    const result = adapter.validate(badConfig, RiskClass.READ_ONLY);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('API_KEY'))).toBe(true);
  });

  it('rejects paths outside workspace that are not temp', () => {
    const config = adapter.buildDefaultConfig(RiskClass.INTERNAL_WRITE, '/workspace', 'cp', ['file', '/etc/config']);
    const badConfig = { ...config, allowedPaths: ['/etc'] };
    const result = adapter.validate(badConfig, RiskClass.INTERNAL_WRITE);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('outside workspace'))).toBe(true);
  });

  it('accepts temp paths outside workspace', () => {
    const config = adapter.buildDefaultConfig(RiskClass.INTERNAL_WRITE, '/workspace', 'cp', ['file', '/tmp/out']);
    const goodConfig = { ...config, allowedPaths: ['/tmp/output'] };
    const result = adapter.validate(goodConfig, RiskClass.INTERNAL_WRITE);
    expect(result.valid).toBe(true);
  });
});

describe('SandboxAdapter — Approval Preview', () => {
  const adapter = new SandboxAdapter();

  it('builds a preview for user approval', () => {
    const config = adapter.buildDefaultConfig(RiskClass.INTERNAL_WRITE, '/workspace', 'npm', ['run', 'build']);
    const preview = adapter.buildApprovalPreview(config, 'npm', ['run', 'build']);

    expect(preview.description).toContain('npm run build');
    expect(preview.networkScope).toContain('none (blocked)');
    expect(preview.secrets).toHaveLength(0);
    expect(preview.limits.maxDurationMs).toBe(300_000);
    expect(preview.limits.maxOutputBytes).toBe(1_048_576);
    expect(preview.evidenceCapture).toContain('stdout/stderr');
    expect(preview.evidenceCapture.some((e) => e.includes('filesystem'))).toBe(true);
    expect(preview.riskAssessment.riskScore).toBeGreaterThanOrEqual(0);
    expect(preview.riskAssessment.riskScore).toBeLessThanOrEqual(10);
  });

  it('preview includes network scope when network is enabled', () => {
    const config = adapter.buildDefaultConfig(RiskClass.EXTERNAL_SEND, '/workspace', 'curl', ['https://api.example.com']);
    const networkConfig = {
      ...config,
      networkPolicy: 'approved_domains' as const,
      allowedDomains: ['api.example.com'],
    };
    const preview = adapter.buildApprovalPreview(networkConfig, 'curl', ['https://api.example.com']);
    expect(preview.networkScope).toContain('api.example.com');
  });
});

describe('SandboxAdapter — Network & Path Checks', () => {
  const adapter = new SandboxAdapter();
  const baseConfig = adapter.buildDefaultConfig(RiskClass.INTERNAL_WRITE, '/workspace', 'test', []);

  it('blocks all network when policy is blocked', () => {
    const config = { ...baseConfig, networkPolicy: 'blocked' as const };
    expect(adapter.isNetworkAllowed(config, 'example.com')).toBe(false);
    expect(adapter.isNetworkAllowed(config, '127.0.0.1')).toBe(false);
  });

  it('allows loopback only when policy is loopback_only', () => {
    const config = { ...baseConfig, networkPolicy: 'loopback_only' as const };
    expect(adapter.isNetworkAllowed(config, '127.0.0.1')).toBe(true);
    expect(adapter.isNetworkAllowed(config, 'localhost')).toBe(true);
    expect(adapter.isNetworkAllowed(config, 'example.com')).toBe(false);
  });

  it('allows approved domains and subdomains', () => {
    const config = {
      ...baseConfig,
      networkPolicy: 'approved_domains' as const,
      allowedDomains: ['example.com', 'api.github.com'],
    };
    expect(adapter.isNetworkAllowed(config, 'example.com')).toBe(true);
    expect(adapter.isNetworkAllowed(config, 'sub.example.com')).toBe(true);
    expect(adapter.isNetworkAllowed(config, 'api.github.com')).toBe(true);
    expect(adapter.isNetworkAllowed(config, 'evil.com')).toBe(false);
  });

  it('allows paths within workspace', () => {
    const config = adapter.buildDefaultConfig(RiskClass.READ_ONLY, '/workspace', 'cat', ['src/index.ts']);
    expect(adapter.isPathAllowed(config, '/workspace/src/index.ts')).toBe(true);
    expect(adapter.isPathAllowed(config, '/workspace/docs/readme.md')).toBe(true);
  });

  it('allows temp paths', () => {
    const config = adapter.buildDefaultConfig(RiskClass.READ_ONLY, '/workspace', 'cat', ['/tmp/log.txt']);
    expect(adapter.isPathAllowed(config, '/tmp/log.txt')).toBe(true);
    expect(adapter.isPathAllowed(config, '/temp/cache')).toBe(true);
  });

  it('rejects paths outside workspace', () => {
    const config = adapter.buildDefaultConfig(RiskClass.READ_ONLY, '/workspace', 'cat', ['/etc/passwd']);
    expect(adapter.isPathAllowed(config, '/etc/passwd')).toBe(false);
    expect(adapter.isPathAllowed(config, '/home/other-user/secret')).toBe(false);
  });

  it('allows explicitly whitelisted external paths', () => {
    const config = {
      ...baseConfig,
      allowedPaths: ['/usr/local/bin', '/opt/tools'],
    };
    expect(adapter.isPathAllowed(config, '/usr/local/bin/node')).toBe(true);
    expect(adapter.isPathAllowed(config, '/opt/tools/compiler')).toBe(true);
    expect(adapter.isPathAllowed(config, '/usr/bin/evil')).toBe(false);
  });
});

describe('SandboxAdapter — Execute', () => {
  const adapter = new SandboxAdapter();

  it('executes with stubbed process (returns stub result)', async () => {
    const config = adapter.buildDefaultConfig(RiskClass.READ_ONLY, '/workspace', 'echo', ['hello']);
    const result = await adapter.execute(config, 'echo', ['hello']);

    expect(result.outcome).toBe(SandboxOutcome.Completed);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('stubbed');
    expect(result.evidence.command).toBe('echo');
    expect(result.evidence.config).toEqual(config);
  });

  it('fails on invalid config', async () => {
    const config = adapter.buildDefaultConfig(RiskClass.PAYMENT, '/workspace', 'charge', []);
    const badConfig = { ...config, networkPolicy: 'approved_domains' as const, allowedDomains: ['evil.com'] };
    const result = await adapter.execute(badConfig, 'charge', [], RiskClass.PAYMENT);

    expect(result.outcome).toBe(SandboxOutcome.SandboxError);
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain('Network must be blocked');
  });
});

describe('SandboxAdapter — Events', () => {
  const adapter = new SandboxAdapter();

  it('emits lifecycle events during execution', async () => {
    const events: string[] = [];
    adapter.on('sandbox:preparing', () => events.push('preparing'));
    adapter.on('sandbox:started', () => events.push('started'));
    adapter.on('sandbox:completed', () => events.push('completed'));

    const config = adapter.buildDefaultConfig(RiskClass.READ_ONLY, '/workspace', 'ls', []);
    await adapter.execute(config, 'ls', []);

    expect(events).toContain('preparing');
    expect(events).toContain('started');
    expect(events).toContain('completed');
  });
});
