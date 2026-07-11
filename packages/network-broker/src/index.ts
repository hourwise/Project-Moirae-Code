/**
 * @moirae/network-broker — Outbound connection policy enforcement.
 *
 * Modes (strictest to most permissive):
 *   - blocked: no outbound connections allowed
 *   - loopback-only: only 127.0.0.1 / ::1
 *   - provider-endpoints: loopback + known model provider endpoints
 *   - approved-domains: explicit domain allowlist
 *   - unrestricted: all connections allowed (with warning)
 *
 * A model or tool must not create arbitrary outbound connections
 * merely because it can run shell commands.
 */

export enum NetworkMode {
  BLOCKED = 'blocked',
  LOOPBACK_ONLY = 'loopback_only',
  PROVIDER_ENDPOINTS = 'provider_endpoints',
  APPROVED_DOMAINS = 'approved_domains',
  UNRESTRICTED = 'unrestricted',
}

export interface NetworkPolicy {
  mode: NetworkMode;
  allowedDomains: string[];
  allowedIPs: string[];
}

export interface ConnectionRequest {
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'tcp';
  source: string; // which component is requesting (e.g., 'horae', 'tool:git')
}

export interface ConnectionDecision {
  allowed: boolean;
  reason: string;
  mode: NetworkMode;
}

export interface NetworkBroker {
  getPolicy(): NetworkPolicy;
  setMode(mode: NetworkMode): void;
  allowDomain(domain: string): void;
  disallowDomain(domain: string): void;
  evaluate(request: ConnectionRequest): ConnectionDecision;
}
