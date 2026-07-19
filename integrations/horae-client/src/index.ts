/** Horae's pinned Stage-A surface is embedded/CLI/transport-neutral inspection, not HTTP sessions. */
import { parseRuntimeInspection, type RuntimeInspection } from '@moirae/adrasteia-adapter';
export interface HoraeInspectionClientConfig {
  inspect: () => Promise<unknown> | unknown;
}
export class HoraeSessionTransportUnavailable extends Error {
  constructor() {
    super(
      'Horae session transport is unavailable: Moirae Stage-A does not invent an HTTP session API.',
    );
    this.name = 'HoraeSessionTransportUnavailable';
  }
}
export class HoraeInspectionClient {
  constructor(private readonly config: HoraeInspectionClientConfig) {}
  async inspect(): Promise<RuntimeInspection> {
    return parseRuntimeInspection(await this.config.inspect());
  }
}
/** @deprecated Session operations fail closed until a real Horae handoff exists. */
export class HoraeClient extends HoraeInspectionClient {
  async startSession(): Promise<never> {
    throw new HoraeSessionTransportUnavailable();
  }
  async sendMessage(): Promise<never> {
    throw new HoraeSessionTransportUnavailable();
  }
  async cancelSession(): Promise<never> {
    throw new HoraeSessionTransportUnavailable();
  }
  async getComposition(): Promise<never> {
    throw new HoraeSessionTransportUnavailable();
  }
}
