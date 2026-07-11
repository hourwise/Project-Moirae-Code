/**
 * @moirae/skill-registry — Governed Skill Registry
 *
 * Moirae Code skills are imported, inspected, and governed — not blindly trusted.
 * Each skill has a kind, manifest, provenance, trust state, and revision history.
 *
 * Skill kinds:
 *   - `guidance`   — Rules, patterns, conventions (read-only influence)
 *   - `workflow`   — Multi-step processes, task templates (orchestration)
 *   - `executable` — Code that runs, tools that act (highest risk)
 *
 * Lifecycle: import → inspect → classify → install → pin → update → rollback
 */

export * from './types.js';
export * from './registry.js';
export * from './reticle.js';
