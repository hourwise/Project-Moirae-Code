// ═══════════════════════════════════════════════════════════════
// RUNTIME IDENTITY
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';

/**
 * Well-known runtime names in the Moirae ecosystem.
 */
export const RUNTIME_NAMES = {
  ANANKE: 'ananke',
  MNEMOSYNE: 'mnemosyne',
  HORAE: 'horae',
  MOIRA: 'moira',
} as const;

export type RuntimeName = (typeof RUNTIME_NAMES)[keyof typeof RUNTIME_NAMES];

export const RuntimeNameSchema = z.enum([
  RUNTIME_NAMES.ANANKE,
  RUNTIME_NAMES.MNEMOSYNE,
  RUNTIME_NAMES.HORAE,
  RUNTIME_NAMES.MOIRA,
]);

/**
 * Each runtime must expose a RuntimeIdentity so orchestrators can answer "who are you?"
 */
export const RuntimeIdentitySchema = z.object({
  runtime: z.string().min(1),
  version: z.string().min(1),
  protocolVersion: z.string().min(1),
  minimumProtocolVersion: z.string().optional(),
  instanceId: z.string().optional(),
  displayName: z.string().optional(),
  capabilities: z.array(z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    category: z.string().optional(),
  })).optional(),
});

export type RuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>;
