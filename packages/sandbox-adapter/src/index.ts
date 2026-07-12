/**
 * @moirae/sandbox-adapter — Sandbox Execution Adapter
 *
 * Governed execution environment selection and lifecycle.
 * Implements the research doc Phase 2.7 requirement:
 *   "Execution modes are selected by risk: host, restricted process, container,
 *    microVM, or remote sandbox. Before approval, show repository scope, network
 *    scope, secrets, limits, expected side effects, cleanup plan, and evidence capture."
 *
 * Integrates with network-broker (per-sandbox network policy), policy-profiles
 * (risk-appropriate mode selection), and secret-broker (credential isolation).
 */

export * from './types.js';
export * from './adapter.js';
