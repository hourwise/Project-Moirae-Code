/** Project Adrasteia owns portable runtime contracts; Moirae keeps only a facade during migration. */
import { describe, expect, it } from 'vitest';
import {
  CompatibilityManifestSchema,
  DEFAULT_MINIMUM_SUPPORTED_VERSION,
  DEFAULT_PROTOCOL_VERSION,
  RuntimeHealthSchema,
  RuntimeIdentitySchema,
  negotiateDetailed,
} from 'project-runtime-contracts';
import { RuntimeIdentitySchema as FacadeRuntimeIdentitySchema } from '@moirae/runtime-contracts';

describe('Project Adrasteia contract adoption', () => {
  it('re-exports canonical schemas through the deprecated facade without redefining them', () => {
    expect(FacadeRuntimeIdentitySchema).toBe(RuntimeIdentitySchema);
  });
  it('uses the pinned protocol range and canonical runtime identity validation', () => {
    expect(DEFAULT_PROTOCOL_VERSION).toBe('1.4.0');
    expect(DEFAULT_MINIMUM_SUPPORTED_VERSION).toBe('1.0.0');
    expect(
      RuntimeIdentitySchema.parse({
        runtime: 'moirae-code',
        version: '0.1.0',
        protocolVersion: '1.4.0',
        minimumProtocolVersion: '1.0.0',
        supportedProtocolRange: { minimum: '1.0.0', maximum: '1.4.0' },
      }).runtime,
    ).toBe('moirae-code');
  });
  it('validates health and compatibility using canonical schemas', () => {
    expect(RuntimeHealthSchema.parse({ healthy: true, uptimeMs: 0, warnings: [] }).healthy).toBe(
      true,
    );
    expect(
      CompatibilityManifestSchema.safeParse({
        manifestSchemaVersion: '1.0.0',
        runtimeName: 'moirae-code',
        runtimeVersion: '0.1.0',
        packageVersion: '0.4.0',
        protocolVersion: '1.4.0',
        minimumSupportedProtocolVersion: '1.0.0',
        supportedProtocolRange: { minimum: '1.0.0', maximum: '1.4.0' },
        requiredRuntimeContractsVersionRange: '0.4.0',
        standalone: true,
      }).success,
    ).toBe(true);
  });
  it('uses semantic negotiation and rejects unsupported majors', () => {
    expect(negotiateDetailed('1.4.0', '1.0.0', '1.2.0', '1.0.0')).toMatchObject({
      compatible: true,
      negotiatedVersion: '1.2.0',
    });
    expect(negotiateDetailed('1.4.0', '1.0.0', '2.0.0', '2.0.0')).toMatchObject({
      compatible: false,
      reason: 'unsupported_major',
    });
  });
});
