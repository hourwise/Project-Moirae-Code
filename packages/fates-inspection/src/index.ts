import {
  createMoiraeRuntimeInspection,
  negotiateWithMoirae,
  parseRuntimeInspection,
  type RuntimeInspection,
} from '@moirae/adrasteia-adapter';
import type { ProtocolNegotiationResult } from 'project-runtime-contracts';

export interface PeerInspectionSource {
  id: 'ananke' | 'mnemosyne' | 'horae';
  inspect(): Promise<unknown>;
}
export interface PeerInspectionSummary {
  id: PeerInspectionSource['id'];
  availability: 'available' | 'unavailable';
  inspectedAt: string;
  inspection?: RuntimeInspection;
  compatibility?: ProtocolNegotiationResult;
  limitation?: string;
}
export interface FatesInspectionReport {
  moirae: RuntimeInspection;
  peers: PeerInspectionSummary[];
  inspectionOnly: true;
  knownLimitations: string[];
}

const sanitizeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'Inspection unavailable.';
  return /(?:token|secret|authorization|bearer|[A-Z]:\\|\/Users\/|\/home\/)/i.test(message)
    ? 'Inspection unavailable; sensitive error details redacted.'
    : message.slice(0, 240);
};

export class FatesInspectionCoordinator {
  constructor(
    private readonly input: {
      version: string;
      instanceId: string;
      startedAt: number;
      peers: PeerInspectionSource[];
    },
  ) {}
  async inspect(): Promise<FatesInspectionReport> {
    const moirae = createMoiraeRuntimeInspection(this.input);
    const peers = await Promise.all(
      this.input.peers.map(async (source): Promise<PeerInspectionSummary> => {
        const inspectedAt = new Date().toISOString();
        try {
          const inspection = parseRuntimeInspection(await source.inspect());
          if (inspection.identity.runtime !== source.id)
            throw new Error('Inspection runtime identity does not match configured peer.');
          return {
            id: source.id,
            availability: 'available',
            inspectedAt,
            inspection,
            compatibility: negotiateWithMoirae(inspection.identity),
          };
        } catch (error) {
          return {
            id: source.id,
            availability: 'unavailable',
            inspectedAt,
            limitation: sanitizeError(error),
          };
        }
      }),
    );
    return {
      moirae,
      peers,
      inspectionOnly: true,
      knownLimitations: [
        'No peer action execution, approval, memory retrieval, or orchestration is performed.',
        'Peer-reported health and readiness are not local process observations.',
        'Discovery and compatibility do not grant authority.',
      ],
    };
  }
}
