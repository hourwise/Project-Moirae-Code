/** Read-only client for Ananke's documented public runtime-inspection routes. */
import { parseRuntimeInspection, type RuntimeInspection } from '@moirae/adrasteia-adapter';

export interface AnankeInspectionClientConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}
export class AnankeInspectionUnavailable extends Error {
  constructor(message = 'Ananke runtime inspection is unavailable.') {
    super(message);
    this.name = 'AnankeInspectionUnavailable';
  }
}
export class AnankeStageAUnsupported extends Error {
  constructor() {
    super(
      'Ananke action execution, approval decisions, and audit queries are unavailable in Moirae Stage-A.',
    );
    this.name = 'AnankeStageAUnsupported';
  }
}
export class AnankeInspectionClient {
  private readonly request: typeof fetch;
  constructor(private readonly config: AnankeInspectionClientConfig) {
    this.request = config.fetchImpl ?? fetch;
  }
  async inspect(): Promise<RuntimeInspection> {
    const [identity, health, readiness, registration, compatibility] = await Promise.all([
      this.get('/api/runtime/identity'),
      this.get('/api/runtime/health'),
      this.get('/api/runtime/readiness'),
      this.get('/api/runtime/registration'),
      this.get('/api/runtime/compatibility'),
    ]);
    return parseRuntimeInspection({ identity, health, readiness, registration, compatibility });
  }
  private async get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.request(new URL(path, this.config.baseUrl));
    } catch {
      throw new AnankeInspectionUnavailable();
    }
    if (!response.ok)
      throw new AnankeInspectionUnavailable(`Ananke inspection returned HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch {
      throw new AnankeInspectionUnavailable('Ananke inspection response was not JSON.');
    }
  }
}
/** @deprecated Compatibility shell. It intentionally fails closed for all mutation methods. */
export class AnankeClient extends AnankeInspectionClient {
  async execute(): Promise<never> {
    throw new AnankeStageAUnsupported();
  }
  async approve(): Promise<never> {
    throw new AnankeStageAUnsupported();
  }
  async deny(): Promise<never> {
    throw new AnankeStageAUnsupported();
  }
  async audit(): Promise<never> {
    throw new AnankeStageAUnsupported();
  }
}
