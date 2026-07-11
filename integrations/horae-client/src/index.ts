/**
 * @moirae/horae-client — Typed client for the Horae orchestration API.
 *
 * Horae coordinates: runtime discovery, compatibility negotiation,
 * least-capability task composition, session lifecycle, health supervision,
 * degraded-state coordination, and aggregate task outcomes.
 */

import type { RuntimeSession, RuntimeComposition } from '@moirae/runtime-contracts';

export interface HoraeClientConfig {
  baseUrl: string;
}

export class HoraeClient {
  constructor(private config: HoraeClientConfig) {}

  /** Start a new governed session with a task and profile. */
  async startSession(params: {
    projectId: string;
    task: string;
    profileId?: string;
  }): Promise<RuntimeSession> {
    const res = await fetch(`${this.config.baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return (await res.json()) as RuntimeSession;
  }

  /** Send a message within an active session. */
  async sendMessage(sessionId: string, message: string): Promise<unknown> {
    const res = await fetch(`${this.config.baseUrl}/v1/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    return await res.json();
  }

  /** Cancel an active session. */
  async cancelSession(sessionId: string): Promise<void> {
    await fetch(`${this.config.baseUrl}/v1/sessions/${sessionId}/cancel`, {
      method: 'POST',
    });
  }

  /** Get the current runtime composition for a session. */
  async getComposition(sessionId: string): Promise<RuntimeComposition> {
    const res = await fetch(`${this.config.baseUrl}/v1/sessions/${sessionId}/composition`);
    return (await res.json()) as RuntimeComposition;
  }
}
