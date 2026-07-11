// ═══════════════════════════════════════════════════════════════
// RUNTIME CONTRACTS — Runtime types
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';

// ── Capability ──────────────────────────────────────────────

export enum CapabilityCategory {
  Approval = 'approval',
  Audit = 'audit',
  Citation = 'citation',
  Discovery = 'discovery',
  Execution = 'execution',
  Gateway = 'gateway',
  Health = 'health',
  Memory = 'memory',
  Policy = 'policy',
  Profile = 'profile',
  Registry = 'registry',
  Search = 'search',
  Session = 'session',
  Tool = 'tool',
  Orchestration = 'orchestration',
  Other = 'other',
}

export const CapabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  category: z.nativeEnum(CapabilityCategory).optional(),
  requiresApproval: z.boolean().optional(),
  riskClass: z.string().optional(),
});

export type Capability = z.infer<typeof CapabilitySchema>;

// ── Runtime Health ──────────────────────────────────────────

export enum RuntimeHealthStatus {
  Healthy = 'healthy',
  Busy = 'busy',
  ReadOnly = 'read_only',
  Updating = 'updating',
  Unavailable = 'unavailable',
  Degraded = 'degraded',
}

export const RuntimeHealthSchema = z.object({
  healthy: z.boolean(),
  status: z.nativeEnum(RuntimeHealthStatus).optional(),
  uptimeMs: z.number(),
  warnings: z.array(z.string()),
  activeSessions: z.number().int().nonnegative().optional(),
});

export type RuntimeHealth = z.infer<typeof RuntimeHealthSchema>;

// ── Runtime Profile ─────────────────────────────────────────

export enum RuntimeProfileMode {
  Autonomous = 'autonomous',
  Ci = 'ci',
  PersonalDevelopment = 'personal_development',
  Production = 'production',
  ReadOnly = 'read_only',
  StrictEnterprise = 'strict_enterprise',
  Testing = 'testing',
}

export const RuntimeProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mode: z.nativeEnum(RuntimeProfileMode).optional(),
  requiredCapabilities: z.array(z.string()).optional(),
  exposedCapabilities: z.array(z.string()).optional(),
  hiddenCapabilities: z.array(z.string()).optional(),
});

export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>;

// ── Runtime Session ─────────────────────────────────────────

export const RuntimeSessionSchema = z.object({
  id: z.string(),
  profileId: z.string().optional(),
  project: z.object({
    id: z.string(),
    name: z.string(),
    rootPath: z.string(),
  }).optional(),
  task: z.object({
    id: z.string().optional(),
    summary: z.string().optional(),
    riskClass: z.string().optional(),
  }).optional(),
  startedAt: z.string(),
  expiresAt: z.string().optional(),
});

export type RuntimeSession = z.infer<typeof RuntimeSessionSchema>;

// ── Runtime Event ───────────────────────────────────────────

export enum RuntimeEventType {
  ApprovalDenied = 'approval.denied',
  ApprovalGranted = 'approval.granted',
  AuditCompleted = 'audit.completed',
  CapabilityHidden = 'capability.hidden',
  CapabilityRegistered = 'capability.registered',
  CapabilityExposed = 'capability.exposed',
  GatewayUnavailable = 'gateway.unavailable',
  MemoryUpdated = 'memory.updated',
  PolicyChanged = 'policy.changed',
  ProfileActivated = 'profile.activated',
  RuntimeHealthChanged = 'runtime.health_changed',
  RuntimeRegistered = 'runtime.registered',
  SessionEnded = 'session.ended',
  SessionStarted = 'session.started',
}

export const RuntimeEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.string(),
  sourceRuntime: z.string(),
  targetRuntime: z.string().optional(),
  sessionId: z.string().optional(),
  correlationId: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;

// ── Runtime Composition ─────────────────────────────────────

export enum RuntimeBindingRole {
  Approval = 'approval',
  Audit = 'audit',
  ExecutionGovernor = 'execution_governor',
  Gateway = 'gateway',
  Memory = 'memory',
  Orchestrator = 'orchestrator',
  Policy = 'policy',
  ToolSource = 'tool_source',
  Other = 'other',
}

export const RuntimeCompositionSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  projectId: z.string().optional(),
  sessionId: z.string().optional(),
  profileId: z.string().optional(),
  protocolVersion: z.string(),
  bindings: z.array(z.object({
    role: z.nativeEnum(RuntimeBindingRole),
    runtime: z.string(),
    capabilityIds: z.array(z.string()).optional(),
    required: z.boolean().optional(),
  })),
  exposedCapabilityIds: z.array(z.string()).optional(),
  hiddenCapabilityIds: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
});

export type RuntimeComposition = z.infer<typeof RuntimeCompositionSchema>;
