// ═══════════════════════════════════════════════════════════════
// PROTOCOL VERSION
// ═══════════════════════════════════════════════════════════════

export interface RuntimeProtocol {
  version: string;
  minimumSupported: string;
}

export const ProtocolVersion: RuntimeProtocol = {
  version: '1.1.0',
  minimumSupported: '1.0.0',
};
