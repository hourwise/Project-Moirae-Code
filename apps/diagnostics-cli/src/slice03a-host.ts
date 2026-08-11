import { createHash, randomUUID } from 'node:crypto';
import { createMoiraeRuntimeInspection } from '@moirae/adrasteia-adapter';
import { createHostOperationContext, type HostOperationContext } from '@moirae/host-contracts';

export const SLICE03A_ACTION = 'fates.slice02.inspect-fixed-fixture.v1';
export const SLICE03A_FIXTURE_ID = 'fates.slice02.fixed-fixture.v1';
export const SLICE03A_FIXTURE_SHA256 =
  '7b28f52d84b07bed8b49650960607e8f8a9809cac299810aba691f7f52fe9ae8';
export const SLICE03A_ROUTE_PATH = '/slice-02/governed-actions';
export const SLICE03A_REQUEST_SCHEMA_ID = 'urn:fates:slice02:inspect-fixed-fixture-request:v1';
export const SLICE03A_REQUEST_SCHEMA_SHA256 =
  'db1864fdc4978d6befb4b6d3913461e4f2d2732dd0ca87e076977ab98cf6049c';
export const SLICE03A_R1_REQUEST_SCHEMA_ID =
  'urn:fates:slice02:inspect-fixed-fixture-request:r1-v2';
export const SLICE03A_R1_REQUEST_SCHEMA_SHA256 =
  '104ebc4267914426434968996b2ba2e774ad4ffd6bc2fb4c97b4193a1c7389db';
export const SLICE03A_R1_AUDIENCE_PREFIX = 'fates.slice03a.r1.horae:';
export const SLICE03A_R1_ROUTE_AUDIENCE_SUFFIX = ':POST:/slice-02/governed-actions';
export const SLICE03A_R1_VALIDITY_MS = 59_000;
export const SLICE03A_RUNTIME = 'moirae-code';
export const SLICE03A_VERSION = '0.1.0';
export const SLICE03A_PURPOSE = 'slice02.fixed-fixture-inspection';

const DEFAULT_TIMEOUT_MS = 3_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type Slice03ARequestIdentityVersion = 'legacy-v1' | 'r1-v2';

export interface Slice03AHostConfig {
  instanceId: string;
  artifact: string;
  horaeBaseUrl: string;
  tenantId?: string;
  projectId?: string;
  workspaceId?: string;
  sessionId?: string;
  authenticatedPrincipalId?: string;
  actingPrincipalId?: string;
  requestIdentityVersion?: Slice03ARequestIdentityVersion;
  horaeAudience?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface Slice03AProcessOriginEvidence {
  runtime: typeof SLICE03A_RUNTIME;
  instanceId: string;
  artifact: string;
  processId: number;
  executable: string;
  startedAt: string;
  originId: string;
  originDigest: string;
  requestId: string;
  correlationId: string;
  applicationIdentityVersion?: Slice03ARequestIdentityVersion;
  audience?: string;
}

export type Slice03ARouteState =
  | 'completed'
  | 'denied'
  | 'unavailable'
  | 'stale'
  | 'incompatible'
  | 'malformed'
  | 'timed_out'
  | 'indeterminate';

export type Slice03ADispatchState =
  | 'rejected_before_dispatch'
  | 'dispatch_not_attempted'
  | 'dispatch_confirmed'
  | 'result_received'
  | 'result_lost_indeterminate'
  | 'timed_out_after_dispatch';

export interface Slice03ARouteResult {
  state: Slice03ARouteState;
  routeId: string;
  eventId: string;
  correlation: {
    requestId: string;
    correlationId: string;
    [key: string]: unknown;
  };
  dispatchState: Slice03ADispatchState;
  [key: string]: unknown;
}

export interface Slice03AHostResult {
  hostEvidence: Slice03AProcessOriginEvidence;
  request: {
    action: typeof SLICE03A_ACTION;
    route: typeof SLICE03A_ROUTE_PATH;
    arguments: {
      fixtureId: typeof SLICE03A_FIXTURE_ID;
      expectedSha256: typeof SLICE03A_FIXTURE_SHA256;
    };
  };
  horae: {
    endpoint: string;
    httpStatus: number;
  };
  routeResult: Slice03ARouteResult;
  limitations: string[];
}

export class Slice03AHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Slice03AHostError';
  }
}

/**
 * The smallest Moirae-side 003A boundary. It has no generic action input,
 * no Ananke client, no credential input, and one fixed outbound Horae route.
 */
export class Slice03AHost {
  private readonly request: typeof fetch;
  private readonly timeoutMs: number;
  private readonly startedAt = Date.now();

  constructor(private readonly config: Slice03AHostConfig) {
    validateConfig(config);
    this.request = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): Slice03AHost {
    return new Slice03AHost({
      instanceId: requiredEnvironment(env, 'MOIRAE_003A_INSTANCE_ID'),
      artifact: requiredEnvironment(env, 'MOIRAE_003A_ARTIFACT'),
      horaeBaseUrl: requiredEnvironment(env, 'MOIRAE_003A_HORAE_ENDPOINT'),
      ...(env['MOIRAE_003A_TENANT_ID'] ? { tenantId: env['MOIRAE_003A_TENANT_ID'] } : {}),
      ...(env['MOIRAE_003A_PROJECT_ID'] ? { projectId: env['MOIRAE_003A_PROJECT_ID'] } : {}),
      ...(env['MOIRAE_003A_WORKSPACE_ID'] ? { workspaceId: env['MOIRAE_003A_WORKSPACE_ID'] } : {}),
      ...(env['MOIRAE_003A_SESSION_ID'] ? { sessionId: env['MOIRAE_003A_SESSION_ID'] } : {}),
      ...(env['MOIRAE_003A_AUTHENTICATED_PRINCIPAL']
        ? { authenticatedPrincipalId: env['MOIRAE_003A_AUTHENTICATED_PRINCIPAL'] }
        : {}),
      ...(env['MOIRAE_003A_ACTING_PRINCIPAL']
        ? { actingPrincipalId: env['MOIRAE_003A_ACTING_PRINCIPAL'] }
        : {}),
      requestIdentityVersion: requestIdentityVersionFromEnvironment(env),
      ...(env['MOIRAE_003A_HORAE_AUDIENCE']
        ? { horaeAudience: env['MOIRAE_003A_HORAE_AUDIENCE'] }
        : {}),
    });
  }

  /** Builds the exact bounded request; callers cannot supply an action or arguments. */
  buildRequest(): {
    body: Record<string, unknown>;
    evidence: Slice03AProcessOriginEvidence;
  } {
    const requestId = `moirae-003a-request-${randomUUID()}`;
    const correlationId = `moirae-003a-correlation-${randomUUID()}`;
    const originId = `moirae-003a-origin-${process.pid}-${randomUUID()}`;
    const validity = slice03AR1Validity();
    const hostIdentity = createMoiraeRuntimeInspection({
      version: SLICE03A_VERSION,
      instanceId: this.config.instanceId,
      startedAt: this.startedAt,
    }).identity;
    const execution = {
      authenticatedPrincipal: {
        id: this.config.authenticatedPrincipalId ?? 'moirae-003a-host',
        kind: 'service' as const,
        tenantId: this.config.tenantId ?? 'fates-003a-tenant',
      },
      actingPrincipal: {
        id: this.config.actingPrincipalId ?? 'moirae-003a-agent',
        kind: 'agent' as const,
        tenantId: this.config.tenantId ?? 'fates-003a-tenant',
      },
      runtimeId: SLICE03A_RUNTIME,
      runtimeInstanceId: this.config.instanceId,
      tenantId: this.config.tenantId ?? 'fates-003a-tenant',
      projectId: this.config.projectId ?? 'fates-003a-project',
      workspaceId: this.config.workspaceId ?? 'fates-003a-workspace',
      sessionId: this.config.sessionId ?? `fates-003a-session-${process.pid}`,
    };
    const scope = {
      mode: 'bounded' as const,
      tenantId: execution.tenantId,
      projectId: execution.projectId,
      workspaceId: execution.workspaceId,
      resourceType: 'fixed-fixture',
      resourceIds: [SLICE03A_FIXTURE_ID],
      operations: ['read'],
    };
    const context: HostOperationContext = createHostOperationContext({
      execution,
      scope,
      correlation: { requestId, correlationId },
      purpose: SLICE03A_PURPOSE,
      project: {
        id: execution.projectId,
        name: 'Fates Slice 03A',
        rootPath: 'fates-slice03a',
        workspaceId: execution.workspaceId,
        tenantId: execution.tenantId,
      },
      hostIdentity,
    });
    const requestIdentity = this.requestIdentity(originId, validity);
    const body: Record<string, unknown> = {
      action: SLICE03A_ACTION,
      arguments: {
        fixtureId: SLICE03A_FIXTURE_ID,
        expectedSha256: SLICE03A_FIXTURE_SHA256,
      },
      origin: {
        runtime: SLICE03A_RUNTIME,
        instanceId: this.config.instanceId,
        artifact: this.config.artifact,
        receipt: requestIdentity.receipt,
      },
      execution: context.execution,
      scope: context.scope,
      purpose: context.purpose,
      correlation: context.correlation,
    };
    return {
      body,
      evidence: {
        runtime: SLICE03A_RUNTIME,
        instanceId: this.config.instanceId,
        artifact: this.config.artifact,
        processId: process.pid,
        executable: process.execPath,
        startedAt: new Date(this.startedAt).toISOString(),
        originId,
        originDigest: requestIdentity.originDigest,
        requestId,
        correlationId,
        applicationIdentityVersion: requestIdentity.version,
        ...(requestIdentity.audience ? { audience: requestIdentity.audience } : {}),
      },
    };
  }

  private requestIdentity(
    originId: string,
    validity: { notBefore: string; expiresAt: string },
  ): {
    version: Slice03ARequestIdentityVersion;
    originDigest: string;
    audience?: string;
    receipt: Record<string, unknown>;
  } {
    const version = this.config.requestIdentityVersion ?? 'legacy-v1';
    if (version === 'legacy-v1') {
      return {
        version,
        originDigest: slice03AOriginDigest(originId),
        receipt: {
          originId,
          originDigest: slice03AOriginDigest(originId),
          schemaId: SLICE03A_REQUEST_SCHEMA_ID,
          schemaSha256: SLICE03A_REQUEST_SCHEMA_SHA256,
          validity,
        },
      };
    }

    const audience = this.config.horaeAudience!;
    const originDigest = slice03AR1OriginDigest({ originId, audience, validity });
    return {
      version,
      originDigest,
      audience,
      receipt: {
        originId,
        originDigest,
        schemaId: SLICE03A_R1_REQUEST_SCHEMA_ID,
        schemaSha256: SLICE03A_R1_REQUEST_SCHEMA_SHA256,
        audience,
        validity,
      },
    };
  }

  async invoke(): Promise<Slice03AHostResult> {
    const { body, evidence } = this.buildRequest();
    const endpoint = new URL(SLICE03A_ROUTE_PATH, this.config.horaeBaseUrl).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.request(endpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new Slice03AHostError('Horae governed route was unavailable or timed out.');
    } finally {
      clearTimeout(timer);
    }
    let routeResult: unknown;
    try {
      routeResult = await response.json();
    } catch {
      throw new Slice03AHostError('Horae returned a non-JSON route result.');
    }
    const typedRouteResult = parseRouteResult(routeResult);
    return {
      hostEvidence: evidence,
      request: {
        action: SLICE03A_ACTION,
        route: SLICE03A_ROUTE_PATH,
        arguments: {
          fixtureId: SLICE03A_FIXTURE_ID,
          expectedSha256: SLICE03A_FIXTURE_SHA256,
        },
      },
      horae: { endpoint, httpStatus: response.status },
      routeResult: typedRouteResult,
      limitations: [
        '003A proves bounded process-origin and route evidence only.',
        'R1 application request identity is freshness and audience evidence, not OS-authenticated process origin.',
        '003A does not prove OS containment, credential isolation, or complete bypass resistance.',
        'The IDE, renderer, extensions, terminals, child processes, and direct providers remain outside this claim.',
      ],
    };
  }
}

export function slice03AOriginDigest(originId: string): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        originId,
        schemaId: SLICE03A_REQUEST_SCHEMA_ID,
        schemaSha256: SLICE03A_REQUEST_SCHEMA_SHA256,
      }),
    )
    .digest('hex');
}

export function slice03AR1OriginDigest(input: {
  originId: string;
  audience: string;
  validity: { notBefore: string; expiresAt: string };
}): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        action: SLICE03A_ACTION,
        audience: input.audience,
        originId: input.originId,
        schemaId: SLICE03A_R1_REQUEST_SCHEMA_ID,
        schemaSha256: SLICE03A_R1_REQUEST_SCHEMA_SHA256,
        validity: input.validity,
      }),
    )
    .digest('hex');
}

export function slice03AR1Validity(nowMs: number = Date.now()): {
  notBefore: string;
  expiresAt: string;
} {
  if (!Number.isSafeInteger(nowMs)) throw new TypeError('R1 validity clock must be a safe integer');
  return {
    notBefore: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + SLICE03A_R1_VALIDITY_MS).toISOString(),
  };
}

function validateConfig(config: Slice03AHostConfig): void {
  if (!ID_PATTERN.test(config.instanceId)) {
    throw new Slice03AHostError('MOIRAE_003A_INSTANCE_ID is malformed.');
  }
  if (!config.artifact.trim()) throw new Slice03AHostError('003A host artifact is required.');
  let url: URL;
  try {
    url = new URL(config.horaeBaseUrl);
  } catch {
    throw new Slice03AHostError('003A Horae endpoint is malformed.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Slice03AHostError('003A Horae endpoint must be an unauthenticated HTTP(S) base URL.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Slice03AHostError('003A Horae endpoint must be a base URL without a path or query.');
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Slice03AHostError('003A host timeout must be a positive safe integer.');
  }
  const requestIdentityVersion = config.requestIdentityVersion ?? 'legacy-v1';
  if (requestIdentityVersion !== 'legacy-v1' && requestIdentityVersion !== 'r1-v2') {
    throw new Slice03AHostError('MOIRAE_003A_REQUEST_IDENTITY_VERSION is unsupported.');
  }
  if (requestIdentityVersion === 'r1-v2') {
    if (!config.horaeAudience || !isCanonicalR1Audience(config.horaeAudience)) {
      throw new Slice03AHostError('MOIRAE_003A_HORAE_AUDIENCE is required and malformed.');
    }
  }
}

function requiredEnvironment(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value?.trim())
    throw new Slice03AHostError(`${name} is required for the trusted launch configuration.`);
  return value;
}

function requestIdentityVersionFromEnvironment(
  env: NodeJS.ProcessEnv,
): Slice03ARequestIdentityVersion {
  const value = env['MOIRAE_003A_REQUEST_IDENTITY_VERSION'] ?? 'legacy-v1';
  if (value !== 'legacy-v1' && value !== 'r1-v2') {
    throw new Slice03AHostError('MOIRAE_003A_REQUEST_IDENTITY_VERSION is unsupported.');
  }
  if (value === 'r1-v2' && !env['MOIRAE_003A_HORAE_AUDIENCE']?.trim()) {
    throw new Slice03AHostError('MOIRAE_003A_HORAE_AUDIENCE is required for R1 identity.');
  }
  return value;
}

function isCanonicalR1Audience(value: string): boolean {
  if (
    !value.startsWith(SLICE03A_R1_AUDIENCE_PREFIX) ||
    !value.endsWith(SLICE03A_R1_ROUTE_AUDIENCE_SUFFIX)
  ) {
    return false;
  }
  const instanceId = value.slice(
    SLICE03A_R1_AUDIENCE_PREFIX.length,
    value.length - SLICE03A_R1_ROUTE_AUDIENCE_SUFFIX.length,
  );
  return ID_PATTERN.test(instanceId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const ROUTE_STATES = new Set<Slice03ARouteState>([
  'completed',
  'denied',
  'unavailable',
  'stale',
  'incompatible',
  'malformed',
  'timed_out',
  'indeterminate',
]);

const DISPATCH_STATES = new Set<Slice03ADispatchState>([
  'rejected_before_dispatch',
  'dispatch_not_attempted',
  'dispatch_confirmed',
  'result_received',
  'result_lost_indeterminate',
  'timed_out_after_dispatch',
]);

function parseRouteResult(value: unknown): Slice03ARouteResult {
  if (!isRecord(value)) throw new Slice03AHostError('Horae returned a malformed route result.');
  const state = value['state'];
  const routeId = value['routeId'];
  const eventId = value['eventId'];
  const dispatchState = value['dispatchState'];
  const correlation = value['correlation'];
  if (typeof state !== 'string' || !ROUTE_STATES.has(state as Slice03ARouteState)) {
    throw new Slice03AHostError('Horae returned an unknown route state.');
  }
  if (typeof routeId !== 'string' || !routeId) {
    throw new Slice03AHostError('Horae returned a route result without a route identifier.');
  }
  if (typeof eventId !== 'string' || !eventId) {
    throw new Slice03AHostError('Horae returned a route result without an event identifier.');
  }
  if (
    typeof dispatchState !== 'string' ||
    !DISPATCH_STATES.has(dispatchState as Slice03ADispatchState)
  ) {
    throw new Slice03AHostError('Horae returned a route result without a valid dispatch state.');
  }
  if (!isRecord(correlation)) {
    throw new Slice03AHostError('Horae returned a route result without correlation evidence.');
  }
  const requestId = correlation['requestId'];
  const correlationId = correlation['correlationId'];
  if (typeof requestId !== 'string' || !requestId) {
    throw new Slice03AHostError('Horae returned a route result without a request identifier.');
  }
  if (typeof correlationId !== 'string' || !correlationId) {
    throw new Slice03AHostError('Horae returned a route result without a correlation identifier.');
  }
  return value as Slice03ARouteResult;
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Unsupported canonical value.');
}
