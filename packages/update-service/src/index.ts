/**
 * @moirae/update-service — Auto-updater with signed manifests and rollback.
 *
 * Release channels: stable, beta, nightly.
 * Updates are verified via signed manifests before installation.
 * Failed updates can be rolled back to the previous version.
 */

export enum ReleaseChannel {
  STABLE = 'stable',
  BETA = 'beta',
  NIGHTLY = 'nightly',
}

export interface UpdateManifest {
  version: string;
  channel: ReleaseChannel;
  releaseDate: string;
  minMoiraeVersion: string;
  downloadUrl: string;
  sha256: string;
  signature: string;
  releaseNotes: string;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  channel: ReleaseChannel;
  updateAvailable: boolean;
  lastChecked: string;
}

// Placeholder — update service will be implemented in Phase 3 (Distribution).
export const UPDATE_SERVICE_VERSION = '0.1.0';
