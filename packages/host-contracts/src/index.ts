/** Moirae-owned contracts. Portable Fates contracts belong to Project Adrasteia. */
import { z } from 'zod';
import {
  AgentExecutionContextSchema,
  CorrelationContextSchema,
  PrincipalIdentitySchema,
  ProjectIdentitySchema,
  ResourceScopeMode,
  ResourceScopeSchema,
  RuntimeIdentitySchema,
} from 'project-runtime-contracts';

export enum LocalProcessState {
  NotManaged = 'not_managed',
  SpawnDisabled = 'spawn_disabled',
  Starting = 'starting',
  Running = 'running',
  Exited = 'exited',
  Crashed = 'crashed',
}

export interface ComponentConfig {
  enabled: boolean;
  port?: number;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  startupTimeoutMs: number;
}

export interface SupervisorConfig {
  projectRoot: string;
  dataDir: string;
  autoStart: boolean;
  components: Record<'ananke' | 'mnemosyne' | 'horae', ComponentConfig>;
  healthCheckIntervalMs: number;
  maxRestartAttempts: number;
  restartCooldownMs: number;
}

export interface ComponentHealth {
  componentId: string;
  status: LocalProcessState;
  pid: number | null;
  port: number | null;
  startedAt: string | null;
  exitCode: number | null;
  restartCount: number;
  lastError: string | null;
  lastObservedAt: string;
}

export interface CrashRecord {
  componentId: string;
  timestamp: string;
  exitCode: number | null;
  signal: string | null;
  stderr: string | null;
  restartAttempt: number;
  recoveryAction: 'restart_disabled' | 'degraded';
}

/** References are descriptive history only; they are never grants or bearer credentials. */
const HistoricalReferencesSchema = z
  .object({
    approvalId: z.string().min(1).optional(),
    auditId: z.string().min(1).optional(),
    grantId: z.string().min(1).optional(),
    stateHandleId: z.string().min(1).optional(),
  })
  .optional();

/** Trusted context assembled at the host boundary; model/IPC fields cannot replace it. */
export const HostOperationContextSchema = z
  .object({
    execution: AgentExecutionContextSchema,
    scope: ResourceScopeSchema,
    correlation: CorrelationContextSchema,
    purpose: z.string().trim().min(1),
    project: ProjectIdentitySchema.extend({
      workspaceId: z.string().min(1).optional(),
      tenantId: z.string().min(1).optional(),
    }),
    hostIdentity: RuntimeIdentitySchema,
    extensionIdentity: PrincipalIdentitySchema.optional(),
    provider: z.object({ providerId: z.string().min(1), modelId: z.string().min(1) }).optional(),
    historicalReferences: HistoricalReferencesSchema,
  })
  .superRefine((value, ctx) => {
    const { execution, scope, project, hostIdentity, extensionIdentity } = value;
    if (hostIdentity.runtime !== 'moirae-code') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hostIdentity', 'runtime'],
        message: 'Host runtime must be moirae-code.',
      });
    }
    if (scope.mode !== ResourceScopeMode.Bounded) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scope', 'mode'],
        message: 'Moirae host operations require a bounded scope.',
      });
    }
    if (execution.projectId !== project.id || scope.projectId !== project.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['project'],
        message: 'Execution, scope, and project IDs must match.',
      });
    }
    if (
      project.workspaceId &&
      (execution.workspaceId !== project.workspaceId || scope.workspaceId !== project.workspaceId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['project', 'workspaceId'],
        message: 'Execution, scope, and workspace IDs must match.',
      });
    }
    if (
      project.tenantId &&
      (execution.tenantId !== project.tenantId || scope.tenantId !== project.tenantId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['project', 'tenantId'],
        message: 'Execution, scope, and tenant IDs must match.',
      });
    }
    if (
      extensionIdentity &&
      (extensionIdentity.id === execution.authenticatedPrincipal.id ||
        extensionIdentity.id === execution.actingPrincipal.id)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['extensionIdentity'],
        message: 'An extension identity cannot replace an authenticated or acting principal.',
      });
    }
  });

export type HostOperationContext = z.infer<typeof HostOperationContextSchema>;
export const createHostOperationContext = (input: unknown): HostOperationContext =>
  HostOperationContextSchema.parse(input);

export type HostToolProposalStatus =
  | 'proposed'
  | 'malformed'
  | 'blocked_no_horae_handoff'
  | 'blocked_no_ananke_handoff'
  | 'rejected_by_host_boundary'
  | 'cancelled';
export interface HostToolProposal {
  proposalId: string;
  status: HostToolProposalStatus;
  context: HostOperationContext;
  providerId: string;
  modelId: string;
  toolName: string;
  serverId?: string;
  arguments: Record<string, unknown> | null;
  argumentSummary: string;
  capability: string;
  scope: HostOperationContext['scope'];
  purpose: string;
  correlation: HostOperationContext['correlation'];
  createdAt: string;
  reason?: string;
}

export interface CredentialReference {
  providerId: string;
  accountId: string;
  scope: string[];
}
export interface CredentialLease {
  value: string;
  expiresAt?: string;
}
export interface CredentialAccessor {
  lease(reference: CredentialReference, signal?: AbortSignal): Promise<CredentialLease | null>;
}
