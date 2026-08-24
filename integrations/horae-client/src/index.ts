/** Horae's pinned Stage-A surface is embedded/CLI/transport-neutral inspection, not HTTP sessions. */
import { parseRuntimeInspection, type RuntimeInspection } from '@moirae/adrasteia-adapter';
export interface HoraeInspectionClientConfig {
  inspect: () => Promise<unknown> | unknown;
}

/** Transport-neutral host envelope for the first real Moirae -> Horae route. */
export interface MoiraeGovernedRequestEnvelope<TRequest = unknown> {
  idempotencyKey: string;
  sessionRequest: TRequest;
  source: {
    sourceId: string;
    canonicalPath?: string;
    sourceUri?: string;
    sourceHash?: string;
  };
  content: unknown;
  contentAccess: unknown;
  memoryId: string;
  origin: {
    runtime: 'moirae-code';
    instanceId: string;
    artifact: string;
  };
}

export function createMoiraeGovernedRequest<TRequest>(input: {
  idempotencyKey: string;
  sessionRequest: TRequest;
  source: MoiraeGovernedRequestEnvelope<TRequest>['source'];
  content: unknown;
  contentAccess: unknown;
  memoryId: string;
  instanceId: string;
  artifact: string;
}): MoiraeGovernedRequestEnvelope<TRequest> {
  if (!input.idempotencyKey.trim()) throw new TypeError('Moirae request idempotency key is required.');
  if (!input.source.sourceId.trim()) throw new TypeError('Moirae request source is required.');
  if (!input.memoryId.trim()) throw new TypeError('Moirae request memory target is required.');
  return {
    idempotencyKey: input.idempotencyKey,
    sessionRequest: input.sessionRequest,
    source: { ...input.source },
    content: input.content,
    contentAccess: input.contentAccess,
    memoryId: input.memoryId,
    origin: {
      runtime: 'moirae-code',
      instanceId: input.instanceId,
      artifact: input.artifact,
    },
  };
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
