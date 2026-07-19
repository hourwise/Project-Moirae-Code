/**
 * @moirae/sandbox-adapter — Core Types
 *
 * Execution modes, sandbox configuration, results, and evidence types.
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════
// EXECUTION MODE
// ═══════════════════════════════════════════════════════════════

export enum ExecutionMode {
  /** Run directly on the host with no isolation (lowest risk operations only). */
  Host = 'host',
  /** Run as a restricted child process with limited environment, working dir, and resources. */
  RestrictedProcess = 'restricted_process',
  /** Run inside a container (Docker/Podman) with filesystem and network isolation. */
  Container = 'container',
  /** Run inside a lightweight microVM (Firecracker, gVisor) for strong isolation. */
  MicroVM = 'microvm',
  /** Run on a remote sandbox server (CI runner, build farm). */
  RemoteSandbox = 'remote_sandbox',
}

export const ExecutionModeSchema = z.nativeEnum(ExecutionMode);

// ═══════════════════════════════════════════════════════════════
// SANDBOX CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export const SandboxConfigSchema = z.object({
  /** Selected execution mode. */
  mode: ExecutionModeSchema,
  /** Working directory restriction: workspace-only, temp-only, or none. */
  workingDirectoryRestriction: z.enum(['workspace', 'temp', 'none']),
  /** Absolute path to the workspace root. */
  workspaceRoot: z.string(),
  /** Allowed paths beyond workspace (must be explicit). */
  allowedPaths: z.array(z.string()),
  /** Maximum execution duration in milliseconds. */
  maxDurationMs: z.number().int().positive(),
  /** Maximum combined stdout+stderr bytes. */
  maxOutputBytes: z.number().int().positive(),
  /** Maximum memory in megabytes. */
  maxMemoryMb: z.number().int().positive().optional(),
  /** Maximum CPU percentage (1-100). */
  maxCpuPercent: z.number().int().min(1).max(100).optional(),
  /** Network policy for the sandboxed process. */
  networkPolicy: z.enum(['blocked', 'loopback_only', 'approved_domains']),
  /** Allowed network destinations (used when networkPolicy is approved_domains). */
  allowedDomains: z.array(z.string()),
  /** Whether child processes are permitted. */
  allowChildProcesses: z.boolean(),
  /** Environment variables explicitly allowed (all others stripped). */
  environmentAllowlist: z.array(z.string()),
  /** Whether the sandboxed process may access secrets from the broker. */
  secretsPolicy: z.enum(['none', 'allowlist', 'all']),
  /** Specific secret descriptors allowed (used when secretsPolicy is allowlist). */
  allowedSecrets: z.array(z.string()),
  /** Whether to capture stdout/stderr as evidence. */
  captureOutput: z.boolean(),
  /** Whether to capture filesystem changes as evidence. */
  captureFilesystemChanges: z.boolean(),
  /** Cleanup plan: what happens to temp files/sandbox after execution. */
  cleanupPlan: z.enum(['discard', 'preserve_output', 'preserve_all']),
});

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

// ═══════════════════════════════════════════════════════════════
// SANDBOX RESULT
// ═══════════════════════════════════════════════════════════════

export interface SandboxResult {
  /** Overall outcome. */
  outcome: SandboxOutcome;
  /** Exit code of the executed command (if applicable). */
  exitCode: number | null;
  /** Captured stdout (truncated to maxOutputBytes). */
  stdout: string;
  /** Captured stderr (truncated to maxOutputBytes). */
  stderr: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Peak memory usage in MB (if measurable). */
  peakMemoryMb: number | null;
  /** Whether output was truncated. */
  outputTruncated: boolean;
  /** Whether the sandbox was forcibly terminated (timeout/OOM). */
  forciblyTerminated: boolean;
  /** Collected evidence from the execution. */
  evidence: SandboxEvidence;
}

export enum SandboxOutcome {
  /** No process was started; Stage-A intentionally fails closed. */
  Unavailable = 'unavailable',
  Completed = 'completed',
  Failed = 'failed',
  TimedOut = 'timed_out',
  OutOfMemory = 'out_of_memory',
  NetworkBlocked = 'network_blocked',
  PathViolation = 'path_violation',
  SecretAccessDenied = 'secret_access_denied',
  SandboxError = 'sandbox_error',
  Cancelled = 'cancelled',
}

// ═══════════════════════════════════════════════════════════════
// SANDBOX EVIDENCE
// ═══════════════════════════════════════════════════════════════

export interface SandboxEvidence {
  /** True only when an execution process actually began. */
  executionStarted: boolean;
  /** The sandbox configuration used (for audit trail). */
  config: SandboxConfig;
  /** Command or operation executed. */
  command: string;
  /** Command arguments. */
  args: string[];
  /** Working directory at execution time. */
  workingDirectory: string;
  /** Start time (ISO 8601). */
  startTime: string;
  /** End time (ISO 8601). */
  endTime: string;
  /** Files created during execution. */
  filesCreated: string[];
  /** Files modified during execution. */
  filesModified: string[];
  /** Files deleted during execution. */
  filesDeleted: string[];
  /** Network connections attempted (host:port). */
  networkAttempts: string[];
  /** Network connections blocked by policy. */
  networkBlocked: string[];
  /** Path access violations detected. */
  pathViolations: string[];
  /** Resource usage summary. */
  resourceUsage: {
    cpuTimeMs: number;
    maxMemoryMb: number;
    diskReadBytes: number;
    diskWriteBytes: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// APPROVAL PREVIEW (shown to user before execution)
// ═══════════════════════════════════════════════════════════════

export interface SandboxApprovalPreview {
  /** Human-readable description of what will execute. */
  description: string;
  /** Repository scope: which files/directories are affected. */
  repositoryScope: string[];
  /** Network scope: which endpoints may be contacted. */
  networkScope: string[];
  /** Secrets that will be available to the sandbox. */
  secrets: string[];
  /** Resource limits. */
  limits: {
    maxDurationMs: number;
    maxOutputBytes: number;
    maxMemoryMb: number | null;
    maxCpuPercent: number | null;
  };
  /** Expected side effects. */
  expectedSideEffects: string[];
  /** How the sandbox will be cleaned up after execution. */
  cleanupPlan: string;
  /** How evidence will be captured. */
  evidenceCapture: string[];
  /** Risk assessment. */
  riskAssessment: {
    mode: ExecutionMode;
    riskScore: number;
    riskFactors: string[];
  };
}
