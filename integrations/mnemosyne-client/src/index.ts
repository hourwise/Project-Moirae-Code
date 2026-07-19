/** Mnemosyne is transport-neutral in its pinned Stage-A checkpoint. */
import { parseRuntimeInspection, type RuntimeInspection } from '@moirae/adrasteia-adapter';
export interface MnemosyneInspectionClientConfig {
  inspect: () => Promise<unknown> | unknown;
}
export class QualifiedContextBoundaryUnavailable extends Error {
  constructor() {
    super('Qualified Mnemosyne context is unavailable: Stage-A exposes inspection only.');
    this.name = 'QualifiedContextBoundaryUnavailable';
  }
}
export class MnemosyneInspectionClient {
  constructor(private readonly config: MnemosyneInspectionClientConfig) {}
  async inspect(): Promise<RuntimeInspection> {
    return parseRuntimeInspection(await this.config.inspect());
  }
}
/** @deprecated No MCP memory transport or qualified context is implemented in Moirae Stage-A. */
export class MnemosyneClient extends MnemosyneInspectionClient {
  async status(): Promise<never> {
    throw new QualifiedContextBoundaryUnavailable();
  }
  async search(): Promise<never> {
    throw new QualifiedContextBoundaryUnavailable();
  }
  async getContextPack(): Promise<never> {
    throw new QualifiedContextBoundaryUnavailable();
  }
  async readMemory(): Promise<never> {
    throw new QualifiedContextBoundaryUnavailable();
  }
  async writeMemory(): Promise<never> {
    throw new QualifiedContextBoundaryUnavailable();
  }
  async reportConflict(): Promise<never> {
    throw new QualifiedContextBoundaryUnavailable();
  }
  async revalidate(): Promise<never> {
    throw new QualifiedContextBoundaryUnavailable();
  }
}
