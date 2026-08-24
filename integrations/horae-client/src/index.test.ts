import { describe, expect, it } from 'vitest';
import { createMoiraeGovernedRequest } from './index.js';

describe('Moirae governed Horae envelope', () => {
  it('binds a request to the Moirae origin and source without changing payload semantics', () => {
    const envelope = createMoiraeGovernedRequest({
      idempotencyKey: 'moirae-request-001',
      sessionRequest: { correlation: { requestId: 'request-001' } },
      source: { sourceId: 'file:docs/input.md', canonicalPath: 'docs/input.md' },
      content: 'source content',
      contentAccess: { destination: 'mnemosyne', exposure: 'SELECTED_CONTENT' },
      memoryId: 'memory-001',
      instanceId: 'moirae-test-001',
      artifact: 'moirae-governed-request-test',
    });

    expect(envelope.origin).toEqual({
      runtime: 'moirae-code',
      instanceId: 'moirae-test-001',
      artifact: 'moirae-governed-request-test',
    });
    expect(envelope.source.canonicalPath).toBe('docs/input.md');
    expect(envelope.contentAccess).toEqual({ destination: 'mnemosyne', exposure: 'SELECTED_CONTENT' });
  });
});
