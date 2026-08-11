import { describe, expect, it, vi } from 'vitest';
import {
  SLICE03A_ACTION,
  SLICE03A_FIXTURE_ID,
  SLICE03A_FIXTURE_SHA256,
  SLICE03A_REQUEST_SCHEMA_ID,
  SLICE03A_REQUEST_SCHEMA_SHA256,
  SLICE03A_R1_REQUEST_SCHEMA_ID,
  SLICE03A_R1_REQUEST_SCHEMA_SHA256,
  SLICE03A_R1_VALIDITY_MS,
  SLICE03A_ROUTE_PATH,
  Slice03AHost,
  Slice03AHostError,
  slice03AOriginDigest,
  slice03AR1OriginDigest,
  slice03AR1Validity,
} from './slice03a-host.js';

const config = (fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) =>
  new Slice03AHost({
    instanceId: 'moirae-003a-test',
    artifact: 'moirae-003a-test-artifact',
    horaeBaseUrl: 'http://horae.test/',
    fetchImpl,
    ...overrides,
  });

const typedRouteResult = (overrides: Record<string, unknown> = {}) => ({
  state: 'completed',
  routeId: 'route-1',
  eventId: 'event-1',
  correlation: { requestId: 'route-request', correlationId: 'route-correlation' },
  dispatchState: 'result_received',
  ...overrides,
});

describe('Moirae FATES-SLICE-003A host/origin boundary', () => {
  it('builds a bounded R1 validity window from one clock sample', () => {
    const nowMs = Date.parse('2026-08-11T15:24:26.123Z');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    try {
      const validity = slice03AR1Validity();
      const durationMs = Date.parse(validity.expiresAt) - Date.parse(validity.notBefore);

      expect(nowSpy).toHaveBeenCalledTimes(1);
      expect(durationMs).toBe(SLICE03A_R1_VALIDITY_MS);
      expect(durationMs).toBeLessThan(60_000);
      expect(slice03AR1Validity(nowMs + 1)).toEqual({
        notBefore: '2026-08-11T15:24:26.124Z',
        expiresAt: '2026-08-11T15:25:25.124Z',
      });
      expect(
        Date.parse(slice03AR1Validity(nowMs + 1).expiresAt) -
          Date.parse(slice03AR1Validity(nowMs + 1).notBefore),
      ).toBeLessThan(60_000);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('builds explicit R1 application identity without claiming process authentication', () => {
    const audience = 'fates.slice03a.r1.horae:horae-r1-test:POST:/slice-02/governed-actions';
    const host = config(async () => new Response('{}'), {
      requestIdentityVersion: 'r1-v2',
      horaeAudience: audience,
    });

    const { body, evidence } = host.buildRequest();
    const receipt = (body.origin as Record<string, any>).receipt as Record<string, any>;

    expect(receipt).toMatchObject({
      schemaId: SLICE03A_R1_REQUEST_SCHEMA_ID,
      schemaSha256: SLICE03A_R1_REQUEST_SCHEMA_SHA256,
      audience,
      validity: {
        notBefore: expect.any(String),
        expiresAt: expect.any(String),
      },
    });
    expect(receipt.originDigest).toBe(
      slice03AR1OriginDigest({
        originId: receipt.originId,
        audience,
        validity: receipt.validity,
      }),
    );
    expect(evidence.applicationIdentityVersion).toBe('r1-v2');
    expect(evidence.audience).toBe(audience);
    expect(JSON.stringify(body)).not.toContain('authorization');
  });

  it('starts with trusted launch identity and sends one fixed request to Horae only', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const host = config(async (input, init) => {
      calls.push({ url: String(input), init });
      const requestBody = JSON.parse(String(init?.body)) as Record<string, any>;
      return new Response(
        JSON.stringify(typedRouteResult({ correlation: requestBody.correlation })),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await host.invoke();
    const body = JSON.parse(calls[0]?.init?.body as string) as Record<string, any>;
    const origin = body.origin as Record<string, any>;
    const receipt = origin.receipt as Record<string, any>;

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`http://horae.test${SLICE03A_ROUTE_PATH}`);
    expect(calls[0]?.init?.headers).toMatchObject({
      accept: 'application/json',
      'content-type': 'application/json',
    });
    expect(body.action).toBe(SLICE03A_ACTION);
    expect(body.arguments).toEqual({
      fixtureId: SLICE03A_FIXTURE_ID,
      expectedSha256: SLICE03A_FIXTURE_SHA256,
    });
    expect(origin).toMatchObject({
      runtime: 'moirae-code',
      instanceId: 'moirae-003a-test',
      artifact: 'moirae-003a-test-artifact',
    });
    expect(receipt).toMatchObject({
      schemaId: SLICE03A_REQUEST_SCHEMA_ID,
      schemaSha256: SLICE03A_REQUEST_SCHEMA_SHA256,
    });
    expect(receipt.originId).toContain(`moirae-003a-origin-${process.pid}-`);
    expect(receipt.originDigest).toBe(slice03AOriginDigest(receipt.originId));
    expect(result.hostEvidence.processId).toBe(process.pid);
    expect(result.hostEvidence.originId).toBe(receipt.originId);
    expect(result.hostEvidence.correlationId).toBe(body.correlation.correlationId);
    expect(result.routeResult.correlation).toEqual(body.correlation);
    expect(result.horae.endpoint).toBe(`http://horae.test${SLICE03A_ROUTE_PATH}`);
    expect(result.routeResult).toMatchObject({ state: 'completed', routeId: 'route-1' });
    expect(result.limitations.join(' ')).toContain('does not prove OS containment');
  });

  it('preserves typed Horae drift results without fallback or retry', async () => {
    let calls = 0;
    const host = config(async () => {
      calls += 1;
      return new Response(
        JSON.stringify(
          typedRouteResult({
            state: 'incompatible',
            reason: 'Ananke endpoint drifted',
            dispatchState: 'rejected_before_dispatch',
          }),
        ),
        {
          status: 409,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    const result = await host.invoke();

    expect(calls).toBe(1);
    expect(result.horae.httpStatus).toBe(409);
    expect(result.routeResult.state).toBe('incompatible');
    expect(result.routeResult.dispatchState).toBe('rejected_before_dispatch');
    expect(result.routeResult.reason).toBe('Ananke endpoint drifted');
  });

  it('preserves typed Ananke denial without an alternate path', async () => {
    let calls = 0;
    const host = config(async () => {
      calls += 1;
      return new Response(
        JSON.stringify(
          typedRouteResult({
            state: 'denied',
            dispatchState: 'result_received',
            reason: 'Ananke policy denied the action',
          }),
        ),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await host.invoke();

    expect(calls).toBe(1);
    expect(result.routeResult.state).toBe('denied');
    expect(result.routeResult.reason).toBe('Ananke policy denied the action');
  });

  it('fails closed on malformed route results and malformed process-origin configuration', async () => {
    let calls = 0;
    const host = config(async () => {
      calls += 1;
      return new Response(JSON.stringify({ state: 'completed' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(host.invoke()).rejects.toThrow('route identifier');
    expect(calls).toBe(1);
    expect(
      () =>
        new Slice03AHost({
          instanceId: 'moirae/003a-drifted',
          artifact: 'artifact',
          horaeBaseUrl: 'http://horae.test/',
          fetchImpl: async () => new Response('{}'),
        }),
    ).toThrow('INSTANCE_ID');
  });

  it('fails closed when trusted launch configuration is missing or the endpoint is not a base URL', () => {
    expect(
      () =>
        new Slice03AHost({
          instanceId: 'moirae-003a-test',
          artifact: 'artifact',
          horaeBaseUrl: 'http://horae.test/slice-02/governed-actions',
        }),
    ).toThrow('base URL');
    expect(() => Slice03AHost.fromEnvironment({})).toThrow('MOIRAE_003A_INSTANCE_ID');
    expect(() =>
      Slice03AHost.fromEnvironment({
        MOIRAE_003A_INSTANCE_ID: 'moirae-r1-test',
        MOIRAE_003A_ARTIFACT: 'artifact',
        MOIRAE_003A_HORAE_ENDPOINT: 'http://horae.test',
        MOIRAE_003A_REQUEST_IDENTITY_VERSION: 'r1-v2',
      }),
    ).toThrow('MOIRAE_003A_HORAE_AUDIENCE');
  });

  it('preserves indeterminate transport loss without retry or duplicate dispatch', async () => {
    let calls = 0;
    const host = config(async () => {
      calls += 1;
      return new Response(
        JSON.stringify(
          typedRouteResult({
            state: 'indeterminate',
            dispatchState: 'result_lost_indeterminate',
          }),
        ),
        { status: 504, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await host.invoke();

    expect(calls).toBe(1);
    expect(result.routeResult.state).toBe('indeterminate');
    expect(result.routeResult.dispatchState).toBe('result_lost_indeterminate');
  });

  it('aborts a timed-out Horae request without retry', async () => {
    let calls = 0;
    const host = config(
      async (_input, init) => {
        calls += 1;
        await new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
        return new Response('{}');
      },
      { timeoutMs: 5 },
    );

    await expect(host.invoke()).rejects.toBeInstanceOf(Slice03AHostError);
    expect(calls).toBe(1);
  });

  it('does not retry a transport failure', async () => {
    let calls = 0;
    const host = config(async () => {
      calls += 1;
      throw new Error('network unavailable');
    });

    await expect(host.invoke()).rejects.toBeInstanceOf(Slice03AHostError);
    expect(calls).toBe(1);
  });
});
