/**
 * @moirae/sandbox-adapter — Sandbox Adapter Implementation
 *
 * Governed execution environment. Selects the appropriate sandbox mode based on
 * risk assessment, validates configuration against policy, builds approval previews,
 * and captures structured evidence from execution.
 *
 * Design constraint: process spawning is stubbed. The Fate runtimes (Ananke)
 * will provide the actual execution enforcement. This adapter defines the contract
 * and validation logic that Ananke will consume.
 */

import { EventEmitter } from 'node:events';
import {
  ExecutionMode,
  SandboxOutcome,
  SandboxConfigSchema,
  type SandboxConfig,
  type SandboxResult,
  type SandboxEvidence,
  type SandboxApprovalPreview,
} from './types.js';
import { RiskClass } from '@moirae/tool-sdk';
import { NetworkMode } from '@moirae/network-broker';
import { PolicyDecision } from '@moirae/policy-profiles';

// ═══════════════════════════════════════════════════════════════
// ADAPTER EVENTS
// ═══════════════════════════════════════════════════════════════

export interface SandboxAdapterEvents {
  'sandbox:preparing': (config: SandboxConfig) => void;
  'sandbox:started': (config: SandboxConfig, startTime: string) => void;
  'sandbox:completed': (result: SandboxResult) => void;
  'sandbox:failed': (result: SandboxResult, error: string) => void;
  'sandbox:cleaned': (config: SandboxConfig) => void;
}

// ═══════════════════════════════════════════════════════════════
// RISK → MODE MAPPING
// ═══════════════════════════════════════════════════════════════

const RISK_TO_MODE: Record<RiskClass, ExecutionMode> = {
  [RiskClass.READ_ONLY]: ExecutionMode.RestrictedProcess,
  [RiskClass.INTERNAL_WRITE]: ExecutionMode.RestrictedProcess,
  [RiskClass.EXTERNAL_SEND]: ExecutionMode.Container,
  [RiskClass.DELETE]: ExecutionMode.Container,
  [RiskClass.PAYMENT]: ExecutionMode.MicroVM,
  [RiskClass.DEPLOYMENT]: ExecutionMode.RemoteSandbox,
  [RiskClass.PERMISSION_CHANGE]: ExecutionMode.MicroVM,
  [RiskClass.UNKNOWN]: ExecutionMode.Container, // Default to container for safety
};

// ═══════════════════════════════════════════════════════════════
// ADAPTER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

export class SandboxAdapter extends EventEmitter {
  /**
   * Select the appropriate execution mode based on the risk class of the
   * operation being sandboxed.
   */
  selectMode(riskClass: RiskClass): ExecutionMode {
    return RISK_TO_MODE[riskClass] ?? ExecutionMode.Container;
  }

  /**
   * Build a default sandbox configuration for a given risk class and workspace.
   * This produces safe defaults; callers should override specific fields as needed.
   */
  buildDefaultConfig(
    riskClass: RiskClass,
    workspaceRoot: string,
    command: string,
    args: string[],
  ): SandboxConfig {
    const mode = this.selectMode(riskClass);

    const config: SandboxConfig = {
      mode,
      workingDirectoryRestriction: 'workspace',
      workspaceRoot,
      allowedPaths: [],
      maxDurationMs: riskClass === RiskClass.READ_ONLY ? 60_000 : 300_000,
      maxOutputBytes: riskClass === RiskClass.READ_ONLY ? 256_000 : 1_048_576,
      maxMemoryMb: mode === ExecutionMode.Host ? undefined : 512,
      maxCpuPercent: mode === ExecutionMode.Host ? undefined : 50,
      networkPolicy:
        riskClass === RiskClass.READ_ONLY
          ? 'loopback_only'
          : riskClass === RiskClass.EXTERNAL_SEND
            ? 'approved_domains'
            : 'blocked',
      allowedDomains: [],
      allowChildProcesses: riskClass === RiskClass.READ_ONLY,
      environmentAllowlist: ['PATH', 'HOME', 'USER', 'LANG', 'TEMP'],
      secretsPolicy: 'none',
      allowedSecrets: [],
      captureOutput: true,
      captureFilesystemChanges: riskClass !== RiskClass.READ_ONLY,
      cleanupPlan: 'discard',
    };

    return SandboxConfigSchema.parse(config);
  }

  /**
   * Validate a sandbox configuration. Returns validation errors if the config
   * violates policy or contains unsafe settings for the given risk class.
   */
  validate(config: SandboxConfig, riskClass: RiskClass): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 1. Schema validation
    const parsed = SandboxConfigSchema.safeParse(config);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`${issue.path.join('.')}: ${issue.message}`);
      }
      return { valid: false, errors };
    }

    // 2. Mode is appropriate for risk class
    const expectedMode = this.selectMode(riskClass);
    const modeHierarchy: ExecutionMode[] = [
      ExecutionMode.Host,
      ExecutionMode.RestrictedProcess,
      ExecutionMode.Container,
      ExecutionMode.MicroVM,
      ExecutionMode.RemoteSandbox,
    ];
    const configIndex = modeHierarchy.indexOf(config.mode);
    const expectedIndex = modeHierarchy.indexOf(expectedMode);

    if (configIndex < expectedIndex) {
      errors.push(
        `Execution mode '${config.mode}' is weaker than the minimum '${expectedMode}' required for risk class '${riskClass}'.`,
      );
    }

    // 3. Working directory must be within workspace for restricted+ modes
    if (config.mode !== ExecutionMode.Host && config.workingDirectoryRestriction === 'none') {
      errors.push(
        `Working directory restriction must be 'workspace' or 'temp' for '${config.mode}' mode.`,
      );
    }

    // 4. Network policy consistency
    if (config.networkPolicy !== 'blocked' && riskClass === RiskClass.PAYMENT) {
      errors.push('Network must be blocked for PAYMENT risk class.');
    }

    // 5. Secrets policy
    if (config.secretsPolicy !== 'none' && config.mode === ExecutionMode.Host) {
      errors.push('Secrets must not be exposed in Host execution mode.');
    }

    // 6. Child process restrictions
    if (config.allowChildProcesses && config.mode === ExecutionMode.MicroVM) {
      errors.push(
        'Child processes should not be allowed in MicroVM mode without explicit justification.',
      );
    }

    // 7. Environment allowlist must not include credential-related vars
    const forbiddenEnv = ['API_KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'CREDENTIAL', 'AUTH'];
    for (const env of config.environmentAllowlist) {
      if (forbiddenEnv.some((f) => env.toUpperCase().includes(f))) {
        errors.push(`Environment variable '${env}' matches forbidden credential pattern.`);
      }
    }

    // 8. Allowed paths must be within workspace or explicitly justified
    for (const path of config.allowedPaths) {
      if (
        !path.startsWith(config.workspaceRoot) &&
        !path.startsWith('/tmp/') &&
        !path.startsWith('/temp/')
      ) {
        errors.push(
          `Allowed path '${path}' is outside workspace root '${config.workspaceRoot}' and is not a temp directory.`,
        );
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Build an approval preview to show the user before execution.
   * This is the contract for the approval UI — it surfaces exactly what
   * will happen, what's at risk, and how evidence will be collected.
   */
  buildApprovalPreview(
    config: SandboxConfig,
    command: string,
    args: string[],
  ): SandboxApprovalPreview {
    const riskScore = this.assessRisk(config);

    const evidenceCapture: string[] = [];
    if (config.captureOutput) evidenceCapture.push('stdout/stderr');
    if (config.captureFilesystemChanges)
      evidenceCapture.push('filesystem changes (created/modified/deleted)');

    return {
      description: `${config.mode} execution proposal: ${this.redactCommand(command)} (${args.length} argument${args.length === 1 ? '' : 's'})`,
      repositoryScope: [
        'workspace',
        ...(config.allowedPaths.length > 0
          ? [`${config.allowedPaths.length} configured additional path reference(s)`]
          : []),
      ],
      networkScope:
        config.networkPolicy === 'blocked'
          ? ['none (blocked)']
          : config.networkPolicy === 'loopback_only'
            ? ['127.0.0.1 only']
            : config.allowedDomains,
      secrets: config.allowedSecrets.map(
        (secret) => `secret-reference:${this.redactSecretReference(secret)}`,
      ),
      limits: {
        maxDurationMs: config.maxDurationMs,
        maxOutputBytes: config.maxOutputBytes,
        maxMemoryMb: config.maxMemoryMb ?? null,
        maxCpuPercent: config.maxCpuPercent ?? null,
      },
      expectedSideEffects: this.describeSideEffects(config),
      cleanupPlan: config.cleanupPlan,
      evidenceCapture,
      riskAssessment: {
        mode: config.mode,
        riskScore,
        riskFactors: this.describeRiskFactors(config),
      },
    };
  }

  /**
   * Execute a command in the configured sandbox.
   *
   * Currently stubbed — process spawning is blocked until Fate runtimes
   * provide the execution enforcement layer (Ananke). This method defines
   * the contract: validate config → prepare sandbox → execute → capture
   * evidence → cleanup → return structured result.
   */
  async execute(
    config: SandboxConfig,
    command: string,
    args: string[],
    riskClass: RiskClass = RiskClass.INTERNAL_WRITE,
  ): Promise<SandboxResult> {
    // Validate
    const validation = this.validate(config, riskClass);
    if (!validation.valid) {
      return this.failureResult(
        config,
        command,
        args,
        SandboxOutcome.SandboxError,
        validation.errors.join('; '),
      );
    }

    this.emit('sandbox:preparing', config);
    const startTime = new Date().toISOString();

    // Stage-A does not have an executor. Returning here prevents every legacy
    // stub path below from fabricating a process start, completion, or exit code.
    const unavailable = this.failureResult(
      config,
      command,
      args,
      SandboxOutcome.Unavailable,
      'Sandbox execution is unavailable until a verified Ananke disposition and stable action binding exist.',
    );
    this.emit('sandbox:failed', unavailable, unavailable.stderr);
    return unavailable;

    // TODO: Spawn child process / container / microVM / remote sandbox
    // This is stubbed until Ananke provides the governed execution layer.
    // The adapter contract is complete and testable — only process spawning
    // requires the upstream Fate runtimes.

    this.emit('sandbox:started', config, startTime);
    const endTime = new Date().toISOString();

    const evidence: SandboxEvidence = {
      executionStarted: true,
      config,
      command,
      args,
      workingDirectory: config.workspaceRoot,
      startTime,
      endTime,
      filesCreated: [],
      filesModified: [],
      filesDeleted: [],
      networkAttempts: [],
      networkBlocked: [],
      pathViolations: [],
      resourceUsage: {
        cpuTimeMs: 0,
        maxMemoryMb: 0,
        diskReadBytes: 0,
        diskWriteBytes: 0,
      },
    };

    const result: SandboxResult = {
      outcome: SandboxOutcome.Unavailable,
      exitCode: null,
      stdout: '[sandbox] Execution stubbed — Fate runtime not yet available.',
      stderr: '',
      durationMs: 0,
      peakMemoryMb: null,
      outputTruncated: false,
      forciblyTerminated: false,
      evidence,
    };

    this.emit('sandbox:completed', result);
    return result;
  }

  /**
   * Check whether a specific network destination is permitted under the
   * sandbox's network policy. Uses the network-broker vocabulary.
   */
  isNetworkAllowed(config: SandboxConfig, host: string): boolean {
    switch (config.networkPolicy) {
      case 'blocked':
        return false;
      case 'loopback_only':
        return host === '127.0.0.1' || host === 'localhost' || host === '::1';
      case 'approved_domains':
        return config.allowedDomains.some(
          (domain) => host === domain || host.endsWith('.' + domain),
        );
    }
  }

  /**
   * Check whether a file path is accessible from within the sandbox.
   */
  isPathAllowed(config: SandboxConfig, path: string): boolean {
    const original = path.replace(/\\/g, '/');

    // Detect traversal attempts in the raw path before normalization
    if (original.includes('..')) {
      // Count directory depth to see if traversal escapes workspace root
      const rootDepth = config.workspaceRoot.replace(/\\/g, '/').split('/').filter(Boolean).length;
      const segments = original.split('/');
      let depth = 0;
      for (const seg of segments) {
        if (seg === '..') depth--;
        else if (seg !== '.' && seg !== '') depth++;
      }
      // If the resolved depth is less than workspace root depth, traversal escaped
      if (depth < rootDepth) return false;
    }

    // Normalize slashes for prefix checks
    let normalized = original;
    // Strip leading ../ patterns
    while (normalized.startsWith('../')) normalized = normalized.slice(3);

    if (normalized.startsWith(config.workspaceRoot.replace(/\\/g, '/'))) return true;
    if (normalized.startsWith('/tmp/') || normalized.startsWith('/temp/')) return true;
    return config.allowedPaths.some((allowed) =>
      normalized.startsWith(allowed.replace(/\\/g, '/')),
    );
  }

  // ═══════════════════════════════════════════════════════════
  // INTERNAL
  // ═══════════════════════════════════════════════════════════

  private assessRisk(config: SandboxConfig): number {
    let score = 0;

    // Mode risk
    const modeScores: Record<ExecutionMode, number> = {
      [ExecutionMode.Host]: 8,
      [ExecutionMode.RestrictedProcess]: 4,
      [ExecutionMode.Container]: 2,
      [ExecutionMode.MicroVM]: 1,
      [ExecutionMode.RemoteSandbox]: 1,
    };
    score += modeScores[config.mode] ?? 4;

    // Network exposure
    if (config.networkPolicy !== 'blocked') score += 2;
    if (config.networkPolicy === 'approved_domains' && config.allowedDomains.length > 0) score += 1;

    // Secrets exposure
    if (config.secretsPolicy !== 'none') score += config.allowedSecrets.length;

    // Child processes
    if (config.allowChildProcesses) score += 2;

    // Path breadth
    if (config.allowedPaths.length > 3) score += 1;

    return Math.min(10, score);
  }

  private describeSideEffects(config: SandboxConfig): string[] {
    const effects: string[] = [];
    if (config.captureFilesystemChanges)
      effects.push('May create, modify, or delete files within workspace.');
    if (config.networkPolicy !== 'blocked') effects.push('May make outbound network connections.');
    if (config.secretsPolicy !== 'none')
      effects.push(`May access ${config.allowedSecrets.length} secrets.`);
    if (config.allowChildProcesses) effects.push('May spawn child processes.');
    if (effects.length === 0)
      effects.push('No significant side effects expected (read-only, no network).');
    return effects;
  }

  private describeRiskFactors(config: SandboxConfig): string[] {
    const factors: string[] = [];
    if (config.mode === ExecutionMode.Host)
      factors.push('No process isolation — runs with host privileges.');
    if (config.mode === ExecutionMode.RestrictedProcess)
      factors.push('Process-level isolation only — no filesystem or network namespacing.');
    if (config.networkPolicy !== 'blocked') factors.push('Network access enabled.');
    if (config.secretsPolicy !== 'none') factors.push('Secrets exposed to sandbox.');
    if (config.allowChildProcesses) factors.push('Child processes permitted.');
    if (factors.length === 0) factors.push('Fully sandboxed — no identified risk factors.');
    return factors;
  }

  private failureResult(
    config: SandboxConfig,
    command: string,
    args: string[],
    outcome: SandboxOutcome,
    error: string,
  ): SandboxResult {
    return {
      outcome,
      exitCode: null,
      stdout: '',
      stderr: error,
      durationMs: 0,
      peakMemoryMb: null,
      outputTruncated: false,
      forciblyTerminated: false,
      evidence: {
        executionStarted: false,
        config,
        command: this.redactCommand(command),
        args: args.map(() => '[redacted argument]'),
        workingDirectory: 'workspace',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        filesCreated: [],
        filesModified: [],
        filesDeleted: [],
        networkAttempts: [],
        networkBlocked: [],
        pathViolations: [],
        resourceUsage: { cpuTimeMs: 0, maxMemoryMb: 0, diskReadBytes: 0, diskWriteBytes: 0 },
      },
    };
  }

  private redactCommand(command: string): string {
    return command.length > 0
      ? `[command:${command.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 32) || 'redacted'}]`
      : '[command:redacted]';
  }

  private redactSecretReference(reference: string): string {
    return reference.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 32) || 'redacted';
  }
}
