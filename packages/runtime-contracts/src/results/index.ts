// ═══════════════════════════════════════════════════════════════
// RESULT TYPES — Canonical error/result shapes used by all runtimes
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';

// ── Outcome States ──────────────────────────────────────────

export enum OutcomeState {
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DENIED = 'DENIED',
  WAITING_FOR_APPROVAL = 'WAITING_FOR_APPROVAL',
  APPROVAL_INVALIDATED = 'APPROVAL_INVALIDATED',
  STALE_STATE = 'STALE_STATE',
  TIMED_OUT = 'TIMED_OUT',
  PARTIAL_SUCCESS = 'PARTIAL_SUCCESS',
  CANCELLED = 'CANCELLED',
  COMPENSATION_REQUIRED = 'COMPENSATION_REQUIRED',
  DEGRADED = 'DEGRADED',
}

export const OutcomeStateSchema = z.nativeEnum(OutcomeState);

// ── Runtime Error ───────────────────────────────────────────

export const RuntimeErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean(),
  details: z.record(z.unknown()).optional(),
});

export type RuntimeError = z.infer<typeof RuntimeErrorSchema>;

// ── Generic Result ──────────────────────────────────────────

export interface Result<T> {
  success: boolean;
  data?: T;
  error?: RuntimeError;
}

// ── Outcome Envelope ────────────────────────────────────────

export const OutcomeSchema = z.object({
  state: OutcomeStateSchema,
  retryable: z.boolean(),
  requiresUser: z.boolean(),
  safeToContinue: z.boolean(),
  reasonCode: z.string().optional(),
  nextAction: z.string().optional(),
  data: z.unknown().optional(),
  evidence: z.record(z.unknown()).optional(),
});

export type Outcome = z.infer<typeof OutcomeSchema>;

// ── Severity ────────────────────────────────────────────────

export enum Severity {
  Info = 'info',
  Warning = 'warning',
  Error = 'error',
  Critical = 'critical',
}

export const SeveritySchema = z.nativeEnum(Severity);
