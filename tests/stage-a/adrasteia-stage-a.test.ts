import { describe, expect, it } from 'vitest';
import { createMoiraeRuntimeInspection, parseRuntimeInspection } from '@moirae/adrasteia-adapter';
import { createHostOperationContext, LocalProcessState } from '@moirae/host-contracts';
import { captureToolCallProposal, type ModelEvent } from '@moirae/provider-sdk';
import { SandboxAdapter, SandboxOutcome } from '@moirae/sandbox-adapter';
import { RiskClass } from '@moirae/tool-sdk';
import { AnankeClient, AnankeInspectionClient } from '@moirae/ananke-client';
import { MnemosyneClient } from '@moirae/mnemosyne-client';
import { HoraeClient } from '@moirae/horae-client';
import { FatesInspectionCoordinator } from '@moirae/fates-inspection';

const moirae = () =>
  createMoiraeRuntimeInspection({
    version: '0.1.0',
    instanceId: 'test-instance',
    startedAt: Date.now() - 10,
  });
const peer = (runtime: 'ananke' | 'mnemosyne' | 'horae') => {
  const value = structuredClone(moirae());
  value.identity.runtime = runtime;
  value.registration.identity.runtime = runtime;
  value.compatibility.runtimeName = runtime;
  return value;
};

const context = () =>
  createHostOperationContext({
    execution: {
      authenticatedPrincipal: { id: 'user-1', kind: 'human', tenantId: 'tenant-1' },
      actingPrincipal: { id: 'model-1', kind: 'agent', tenantId: 'tenant-1' },
      runtimeId: 'moirae-code',
      sessionId: 'session-1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      tenantId: 'tenant-1',
    },
    scope: {
      mode: 'bounded',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      tenantId: 'tenant-1',
      resourceIds: ['workspace-1'],
      operations: ['tool.proposed'],
    },
    correlation: { requestId: 'request-1', correlationId: 'correlation-1', sessionId: 'session-1' },
    purpose: 'capture a model proposal',
    project: {
      id: 'project-1',
      name: 'Test',
      rootPath: 'workspace',
      workspaceId: 'workspace-1',
      tenantId: 'tenant-1',
    },
    hostIdentity: moirae().identity,
    provider: { providerId: 'test-provider', modelId: 'test-model' },
    historicalReferences: { approvalId: 'old-approval' },
  });

describe('Adrasteia Stage-A host boundary', () => {
  it('builds schema-valid Moirae inspection with the canonical name and protocol', () => {
    const report = moirae();
    expect(parseRuntimeInspection(report).identity.runtime).toBe('moirae-code');
    expect(report.identity.protocolVersion).toBe('1.4.0');
    expect(report.compatibility.knownConstraints).toContain(
      'Fates integrations are inspection-only.',
    );
  });
  it('rejects model-like context override and mismatched workspace', () => {
    expect(() =>
      createHostOperationContext({
        ...context(),
        project: { ...context().project, workspaceId: 'other' },
      }),
    ).toThrow();
  });
  it('turns tool events into proposals only', () => {
    const event: Extract<ModelEvent, { type: 'tool_call' }> = {
      type: 'tool_call',
      id: 'tool-1',
      name: 'filesystem.write',
      arguments: '{"path":"ignored"}',
    };
    const proposal = captureToolCallProposal(
      context(),
      { providerId: 'test-provider', modelId: 'test-model' },
      event,
    );
    expect(proposal.status).toBe('proposed');
    expect(proposal.scope.projectId).toBe('project-1');
    expect(proposal.argumentSummary).not.toContain('ignored');
  });
  it('marks malformed provider arguments without executing anything', () => {
    const proposal = captureToolCallProposal(
      context(),
      { providerId: 'test-provider', modelId: 'test-model' },
      { type: 'tool_call', id: 'tool-1', name: 'bad', arguments: '{' },
    );
    expect(proposal.status).toBe('malformed');
  });
  it('makes the sandbox unavailable without start or completed events', async () => {
    const adapter = new SandboxAdapter();
    const events: string[] = [];
    adapter.on('sandbox:started', () => events.push('started'));
    adapter.on('sandbox:completed', () => events.push('completed'));
    adapter.on('sandbox:failed', () => events.push('failed'));
    const result = await adapter.execute(
      adapter.buildDefaultConfig(RiskClass.READ_ONLY, '/workspace', 'echo', ['secret-value']),
      'echo',
      ['secret-value'],
    );
    expect(result.outcome).toBe(SandboxOutcome.Unavailable);
    expect(result.exitCode).toBeNull();
    expect(events).toEqual(['failed']);
    expect(result.evidence.executionStarted).toBe(false);
  });
  it('uses only Ananke inspection endpoints and fails legacy operations closed', async () => {
    const report = peer('ananke');
    let calls = 0;
    const client = new AnankeInspectionClient({
      baseUrl: 'https://ananke.invalid',
      fetchImpl: async (url) => {
        calls++;
        const path = new URL(String(url)).pathname;
        const value = path.endsWith('identity')
          ? report.identity
          : path.endsWith('health')
            ? report.health
            : path.endsWith('readiness')
              ? report.readiness
              : path.endsWith('registration')
                ? report.registration
                : report.compatibility;
        return new Response(JSON.stringify(value));
      },
    });
    expect((await client.inspect()).identity.runtime).toBe('ananke');
    expect(calls).toBe(5);
    await expect(new AnankeClient({ baseUrl: 'https://ananke.invalid' }).execute()).rejects.toThrow(
      'unavailable',
    );
  });
  it('keeps Mnemosyne and Horae legacy surfaces unavailable', async () => {
    await expect(
      new MnemosyneClient({ inspect: () => peer('mnemosyne') }).search(),
    ).rejects.toThrow('Qualified');
    await expect(new HoraeClient({ inspect: () => peer('horae') }).startSession()).rejects.toThrow(
      'Horae',
    );
  });
  it('aggregates peer reports without making them local process facts', async () => {
    const result = await new FatesInspectionCoordinator({
      version: '0.1.0',
      instanceId: 'test',
      startedAt: Date.now(),
      peers: [
        { id: 'ananke', inspect: () => peer('ananke') },
        { id: 'mnemosyne', inspect: () => peer('mnemosyne') },
        { id: 'horae', inspect: () => peer('horae') },
      ],
    }).inspect();
    expect(result.peers.every((item) => item.availability === 'available')).toBe(true);
    expect(result.inspectionOnly).toBe(true);
    expect(LocalProcessState.SpawnDisabled).toBe('spawn_disabled');
  });
});
