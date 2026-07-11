/**
 * @moirae/tool-sdk — Governed tool manifest definitions.
 *
 * Every tool requires a manifest: identity, version, publisher, declared permissions,
 * input/output schemas, side-effect classification, network destinations,
 * data handling, integrity hash, and signature status.
 * Unknown capabilities default to denial or isolation.
 */

import { z } from 'zod';

// ── Risk Classes ────────────────────────────────────────────

export enum RiskClass {
  READ_ONLY = 'READ_ONLY',
  INTERNAL_WRITE = 'INTERNAL_WRITE',
  EXTERNAL_SEND = 'EXTERNAL_SEND',
  DELETE = 'DELETE',
  PAYMENT = 'PAYMENT',
  DEPLOYMENT = 'DEPLOYMENT',
  PERMISSION_CHANGE = 'PERMISSION_CHANGE',
  UNKNOWN = 'UNKNOWN',
}

// ── Side Effect Classification ──────────────────────────────

export enum SideEffectClass {
  NONE = 'none',
  FILESYSTEM_READ = 'filesystem_read',
  FILESYSTEM_WRITE = 'filesystem_write',
  NETWORK_OUTBOUND = 'network_outbound',
  SHELL_EXEC = 'shell_exec',
  GIT_LOCAL = 'git_local',
  GIT_REMOTE = 'git_remote',
  CREDENTIAL_ACCESS = 'credential_access',
}

// ── Tool Manifest ───────────────────────────────────────────

export const ToolManifestSchema = z.object({
  identity: z.object({
    name: z.string(),
    version: z.string(),
    publisher: z.string(),
  }),
  description: z.string(),
  riskClass: z.nativeEnum(RiskClass),
  sideEffects: z.array(z.nativeEnum(SideEffectClass)),
  requiresApproval: z.boolean(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  networkDestinations: z.array(z.string()).optional(),
  dataHandling: z.object({
    storesSecrets: z.boolean(),
    sendsDataOffDevice: z.boolean(),
    retainsData: z.boolean(),
  }).optional(),
  integrity: z.object({
    hash: z.string().optional(),
    signatureStatus: z.enum(['unsigned', 'signed', 'verified']).optional(),
  }).optional(),
  executionConstraints: z.object({
    maxDurationMs: z.number().optional(),
    maxOutputBytes: z.number().optional(),
    workingDirectoryRestriction: z.enum(['workspace', 'temp', 'none']).optional(),
    networkPolicy: z.enum(['blocked', 'loopback-only', 'approved-domains', 'unrestricted']).optional(),
  }).optional(),
});

export type ToolManifest = z.infer<typeof ToolManifestSchema>;

// ── Evidence Object ─────────────────────────────────────────

export interface ToolEvidence {
  toolName: string;
  toolVersion: string;
  invocationId: string;
  inputHash: string;
  outputHash: string;
  startTime: string;
  endTime: string;
  affectedResources: string[];
  metrics: Record<string, number>;
}

// ── Validator ───────────────────────────────────────────────

export {
  ManifestValidator,
  ValidationErrorCode,
  ValidationWarningCode,
  PublisherTrust,
} from './validator.js';

export type {
  ManifestValidationResult,
  ManifestValidationError,
  ManifestValidationWarning,
} from './validator.js';
