/**
 * @moirae/policy-profiles — Pre-built policy profiles shipped with Moirae Code.
 *
 * Profiles define risk-class defaults, network policies, tool constraints,
 * and approval requirements for common usage scenarios.
 */

import type { RuntimeProfile } from '@moirae/runtime-contracts';
import { RuntimeProfileMode } from '@moirae/runtime-contracts';
import { RiskClass } from '@moirae/tool-sdk';

export interface PolicyProfile extends RuntimeProfile {
  riskDefaults: Record<RiskClass, PolicyDecision>;
  networkPolicy: NetworkPolicy;
  commandSandbox: CommandSandboxConfig;
}

export enum PolicyDecision {
  ALLOW = 'ALLOW',
  REQUIRE_APPROVAL = 'REQUIRE_APPROVAL',
  DENY = 'DENY',
}

export enum NetworkPolicy {
  BLOCKED = 'blocked',
  LOOPBACK_ONLY = 'loopback_only',
  PROVIDER_ENDPOINTS = 'provider_endpoints',
  APPROVED_DOMAINS = 'approved_domains',
  UNRESTRICTED = 'unrestricted',
}

export interface CommandSandboxConfig {
  workingDirectoryRestriction: 'workspace' | 'temp' | 'none';
  environmentAllowlist: string[];
  defaultTimeoutMs: number;
  maxOutputBytes: number;
  allowChildProcesses: boolean;
}

// ── Standard Profile (local development) ────────────────────

export const STANDARD_PROFILE: PolicyProfile = {
  id: 'moirae.standard',
  name: 'Standard',
  description: 'Safe defaults for local development. Reads allowed; writes require approval.',
  mode: RuntimeProfileMode.PersonalDevelopment,
  riskDefaults: {
    [RiskClass.READ_ONLY]: PolicyDecision.ALLOW,
    [RiskClass.INTERNAL_WRITE]: PolicyDecision.REQUIRE_APPROVAL,
    [RiskClass.EXTERNAL_SEND]: PolicyDecision.REQUIRE_APPROVAL,
    [RiskClass.DELETE]: PolicyDecision.REQUIRE_APPROVAL,
    [RiskClass.PAYMENT]: PolicyDecision.DENY,
    [RiskClass.DEPLOYMENT]: PolicyDecision.REQUIRE_APPROVAL,
    [RiskClass.PERMISSION_CHANGE]: PolicyDecision.REQUIRE_APPROVAL,
    [RiskClass.UNKNOWN]: PolicyDecision.DENY,
  },
  networkPolicy: NetworkPolicy.PROVIDER_ENDPOINTS,
  commandSandbox: {
    workingDirectoryRestriction: 'workspace',
    environmentAllowlist: ['PATH', 'HOME', 'USER', 'LANG'],
    defaultTimeoutMs: 300_000,
    maxOutputBytes: 1_048_576,
    allowChildProcesses: true,
  },
};

// ── Strict Profile (local-only, no network) ─────────────────

export const STRICT_PROFILE: PolicyProfile = {
  id: 'moirae.strict',
  name: 'Strict',
  description: 'Local models only. No outbound network. All writes require approval.',
  mode: RuntimeProfileMode.StrictEnterprise,
  riskDefaults: {
    [RiskClass.READ_ONLY]: PolicyDecision.ALLOW,
    [RiskClass.INTERNAL_WRITE]: PolicyDecision.REQUIRE_APPROVAL,
    [RiskClass.EXTERNAL_SEND]: PolicyDecision.DENY,
    [RiskClass.DELETE]: PolicyDecision.REQUIRE_APPROVAL,
    [RiskClass.PAYMENT]: PolicyDecision.DENY,
    [RiskClass.DEPLOYMENT]: PolicyDecision.DENY,
    [RiskClass.PERMISSION_CHANGE]: PolicyDecision.DENY,
    [RiskClass.UNKNOWN]: PolicyDecision.DENY,
  },
  networkPolicy: NetworkPolicy.LOOPBACK_ONLY,
  commandSandbox: {
    workingDirectoryRestriction: 'workspace',
    environmentAllowlist: ['PATH', 'HOME', 'LANG'],
    defaultTimeoutMs: 300_000,
    maxOutputBytes: 1_048_576,
    allowChildProcesses: false,
  },
};

export const ALL_PROFILES: PolicyProfile[] = [STANDARD_PROFILE, STRICT_PROFILE];
