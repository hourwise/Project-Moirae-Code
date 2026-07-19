/** Pure canonical parsing and Moirae inspection composition. No transport or policy lives here. */
import {
  CapabilityCategory,
  CapabilityExposure,
  CompatibilityManifestSchema,
  DEFAULT_MINIMUM_SUPPORTED_VERSION,
  DEFAULT_PROTOCOL_VERSION,
  RuntimeHealthSchema,
  RuntimeHealthStatus,
  RuntimeIdentitySchema,
  RuntimeKind,
  RuntimeReadinessSchema,
  RuntimeReadinessStatus,
  RuntimeRegistrationSchema,
  RuntimeTransport,
  negotiateDetailed,
  type CompatibilityManifest,
  type RuntimeHealth,
  type RuntimeIdentity,
  type RuntimeReadiness,
  type RuntimeRegistration,
} from 'project-runtime-contracts';

export const ADRASTEIA_BASELINE = Object.freeze({
  packageName: 'project-runtime-contracts',
  packageVersion: '0.4.0',
  protocolVersion: DEFAULT_PROTOCOL_VERSION,
  minimumProtocolVersion: DEFAULT_MINIMUM_SUPPORTED_VERSION,
  artifactSha256: '11ee062b079f74d2a4558af315c9b9b12a6aede291d409c48f038d93c416e2c2',
});

export interface RuntimeInspection {
  identity: RuntimeIdentity;
  health: RuntimeHealth;
  readiness: RuntimeReadiness;
  registration: RuntimeRegistration;
  compatibility: CompatibilityManifest;
}

export function parseRuntimeInspection(value: unknown): RuntimeInspection {
  if (!value || typeof value !== 'object')
    throw new Error('Canonical inspection object is required.');
  const record = value as Record<string, unknown>;
  return {
    identity: RuntimeIdentitySchema.parse(record['identity']),
    health: RuntimeHealthSchema.parse(record['health']),
    readiness: RuntimeReadinessSchema.parse(record['readiness']),
    registration: RuntimeRegistrationSchema.parse(record['registration']),
    compatibility: CompatibilityManifestSchema.parse(record['compatibility']),
  };
}

export function negotiateWithMoirae(identity: RuntimeIdentity) {
  return negotiateDetailed(
    DEFAULT_PROTOCOL_VERSION,
    DEFAULT_MINIMUM_SUPPORTED_VERSION,
    identity.protocolVersion,
    identity.minimumProtocolVersion ??
      identity.supportedProtocolRange?.minimum ??
      identity.protocolVersion,
  );
}

export function createMoiraeRuntimeInspection(input: {
  version: string;
  instanceId: string;
  startedAt: number;
  now?: Date;
}): RuntimeInspection {
  const now = (input.now ?? new Date()).toISOString();
  const capabilities = [
    ['host.inspect', 'Host inspection', CapabilityCategory.Health],
    ['provider.registry.inspect', 'Provider registry inspection', CapabilityCategory.Registry],
    ['skill.registry.inspect', 'Skill registry inspection', CapabilityCategory.Registry],
    ['sandbox.config.validate', 'Sandbox configuration validation', CapabilityCategory.Tool],
    ['supervisor.observe', 'Supervisor observation', CapabilityCategory.Health],
    ['diagnostics.inspect', 'Diagnostics inspection', CapabilityCategory.Health],
    ['model.proposal.capture', 'Model proposal capture', CapabilityCategory.Gateway],
  ].map(([id, name, category]) => ({
    id,
    name,
    version: input.version,
    category,
    exposure: CapabilityExposure.Active,
  }));
  const identity = RuntimeIdentitySchema.parse({
    runtime: 'moirae-code',
    version: input.version,
    packageVersion: input.version,
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    minimumProtocolVersion: DEFAULT_MINIMUM_SUPPORTED_VERSION,
    supportedProtocolRange: {
      minimum: DEFAULT_MINIMUM_SUPPORTED_VERSION,
      maximum: DEFAULT_PROTOCOL_VERSION,
    },
    kind: RuntimeKind.Other,
    instanceId: input.instanceId,
    displayName: 'Project Moirae Code',
    capabilities,
  });
  const health = RuntimeHealthSchema.parse({
    healthy: true,
    status: RuntimeHealthStatus.ReadOnly,
    uptimeMs: Math.max(0, Date.now() - input.startedAt),
    checkedAt: now,
    warnings: [
      'Stage-A host: peer integrations are inspection-only and governed execution is unavailable.',
    ],
  });
  const readiness = RuntimeReadinessSchema.parse({
    ready: true,
    status: RuntimeReadinessStatus.Degraded,
    checkedAt: now,
    unavailableIntegrations: [
      'Ananke governed handoff',
      'Mnemosyne qualified-context retrieval',
      'Horae orchestration',
      'sandbox execution',
      'content preflight',
    ],
    dependencies: [
      {
        dependencyId: 'project-runtime-contracts',
        status: RuntimeReadinessStatus.Ready,
        required: true,
      },
      {
        dependencyId: 'stage-a-host-boundary',
        status: RuntimeReadinessStatus.Ready,
        required: true,
      },
      {
        dependencyId: 'governed-fates-handoff',
        status: RuntimeReadinessStatus.Degraded,
        required: false,
      },
    ],
  });
  const registration = RuntimeRegistrationSchema.parse({
    identity,
    capabilities,
    health,
    readiness,
    standalone: true,
    endpoints: [
      { transport: RuntimeTransport.Cli, command: 'moirae-diag', args: ['inspect', '--json'] },
    ],
    inspectionMechanism: 'local Stage-A diagnostic inspection',
    degradedModes: [
      'inspection-only Fates peers',
      'proposal capture without handoff',
      'sandbox execution unavailable',
    ],
  });
  const compatibility = CompatibilityManifestSchema.parse({
    manifestSchemaVersion: '1.0.0',
    runtimeName: 'moirae-code',
    runtimeVersion: input.version,
    packageVersion: ADRASTEIA_BASELINE.packageVersion,
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    minimumSupportedProtocolVersion: DEFAULT_MINIMUM_SUPPORTED_VERSION,
    supportedProtocolRange: {
      minimum: DEFAULT_MINIMUM_SUPPORTED_VERSION,
      maximum: DEFAULT_PROTOCOL_VERSION,
    },
    requiredRuntimeContractsVersionRange: '0.4.0',
    standalone: true,
    supportedTransports: [RuntimeTransport.Cli, RuntimeTransport.Local],
    capabilities,
    knownConstraints: [
      'Fates integrations are inspection-only.',
      'Model tool calls are proposals and cannot invoke side effects.',
      'Terminal, built-in Git, debugger, tasks, third-party extensions, and direct provider paths remain ungoverned.',
      'Content preflight is deferred by the Adrasteia Stage-A baseline.',
    ],
    generatedAt: now,
  });
  return { identity, health, readiness, registration, compatibility };
}
