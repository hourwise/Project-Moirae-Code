/**
 * @moirae/ananke-client — Typed HTTP client for the Ananke Outcome Gateway.
 *
 * Ananke governs execution: policy decisions, approval binding, auditability.
 * This client wraps the Ananke HTTP API (default port 3000).
 */

import type { Outcome } from '@moirae/runtime-contracts';

export interface AnankeClientConfig {
  baseUrl: string;
  operatorToken: string;
}

export class AnankeClient {
  constructor(private config: AnankeClientConfig) {}

  /** Execute a tool through the Ananke gateway. */
  async execute(toolName: string, args: Record<string, unknown>): Promise<Outcome> {
    const res = await fetch(`${this.config.baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.operatorToken}` },
      body: JSON.stringify({ tool: toolName, arguments: args }),
    });
    const body = (await res.json()) as { outcome: Outcome };
    return body.outcome;
  }

  /** Approve a pending action by approval ID. */
  async approve(approvalId: string): Promise<void> {
    await fetch(`${this.config.baseUrl}/api/approvals/${approvalId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.operatorToken}` },
    });
  }

  /** Deny a pending action. */
  async deny(approvalId: string): Promise<void> {
    await fetch(`${this.config.baseUrl}/api/approvals/${approvalId}/deny`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.operatorToken}` },
    });
  }

  /** Query the audit log with optional filters. */
  async audit(filters?: { from?: string; to?: string; tool?: string; limit?: number }): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    if (filters?.tool) params.set('tool', filters.tool);
    if (filters?.limit) params.set('limit', String(filters.limit));
    const res = await fetch(`${this.config.baseUrl}/api/audit?${params}`, {
      headers: { Authorization: `Bearer ${this.config.operatorToken}` },
    });
    return (await res.json()) as unknown[];
  }
}
