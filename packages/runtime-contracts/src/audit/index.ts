// ═══════════════════════════════════════════════════════════════
// AUDIT CONTRACTS
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { SeveritySchema } from '../results/index.js';

export const AuditEventSchema = z.object({
  timestamp: z.string(),
  runtime: z.string(),
  event: z.string(),
  severity: SeveritySchema,
  sessionId: z.string().optional(),
  correlationId: z.string().optional(),
  operatorId: z.string().optional(),
  details: z.record(z.unknown()).optional(),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;
