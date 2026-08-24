/**
 * @moirae/secret-broker — OS credential store abstraction.
 *
 * API keys and OAuth tokens are stored exclusively in the OS keychain:
 *   - Windows: Credential Manager
 *   - macOS: Keychain
 *   - Linux: Secret Service / libsecret
 *
 * NEVER stored in: settings.json, repository files, Mnemosyne memory,
 * plaintext SQLite, chat transcripts, environment dumps, or audit payloads.
 */

import { randomUUID } from 'node:crypto';

const PRODUCTION_CREDENTIAL_STORE_BRAND = Symbol('moirae.production-os-backed-credential-store');

export type CredentialStoreMode = 'OS_BACKED' | 'DEVELOPMENT_IN_MEMORY';

export interface SecretBroker {
  readonly credentialStore: CredentialStoreMode;
  get(service: string, account: string): Promise<string | null>;
  set(service: string, account: string, secret: string): Promise<void>;
  delete(service: string, account: string): Promise<void>;
  list(service: string): Promise<string[]>;
}

export interface SecretDescriptor {
  service: string;
  account: string;
  scope: string[];
  expiresAt?: string;
}

export interface CredentialLease {
  leaseId: string;
  service: string;
  account: string;
  scope: string[];
  issuedAt: string;
  expiresAt: string;
}

export interface CredentialDeliveryContext {
  leaseId: string;
  destination: string;
  service: string;
  account: string;
  scope: string[];
}

export class SecretLeaseError extends Error {
  constructor(readonly code: 'invalid_scope' | 'expired' | 'revoked' | 'consumed' | 'not_found' | 'delivery_failed' | 'unavailable', message: string) {
    super(message);
    this.name = 'SecretLeaseError';
  }
}

interface ActiveLease extends CredentialLease {
  secret: string;
  consumedAt?: string;
  revokedAt?: string;
}

export interface SecretLeaseManagerOptions {
  now?: () => string;
  maxTtlMs?: number;
}

/**
 * Issues bounded, one-shot credential leases. Raw material remains in the
 * host broker and is passed only to the caller-owned effect boundary callback.
 * Lease metadata is safe for audit/UI surfaces; the secret is never returned.
 */
export class SecretLeaseManager {
  readonly credentialStore: CredentialStoreMode;
  /** Derived from the trusted broker construction path, not from a marker string. */
  readonly productionCredentialStore: boolean;
  private readonly now: () => string;
  private readonly maxTtlMs: number;
  private readonly leases = new Map<string, ActiveLease>();

  constructor(private readonly broker: SecretBroker, options: SecretLeaseManagerOptions = {}) {
    this.credentialStore = broker.credentialStore;
    this.productionCredentialStore = isProductionSecretBroker(broker);
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxTtlMs = options.maxTtlMs ?? 5 * 60 * 1000;
    if (!Number.isSafeInteger(this.maxTtlMs) || this.maxTtlMs <= 0) throw new TypeError('maxTtlMs must be a positive safe integer');
  }

  async issue(descriptor: SecretDescriptor, ttlMs = this.maxTtlMs): Promise<CredentialLease> {
    if (!descriptor.service.trim() || !descriptor.account.trim() || descriptor.scope.length === 0) {
      throw new SecretLeaseError('invalid_scope', 'A lease requires service, account, and at least one scope entry');
    }
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > this.maxTtlMs) {
      throw new SecretLeaseError('invalid_scope', 'Credential lease duration is outside the configured bound');
    }
    const secret = await this.broker.get(descriptor.service, descriptor.account);
    if (secret === null) throw new SecretLeaseError('not_found', 'Credential is unavailable');
    const issuedAt = this.now();
    const lease: ActiveLease = {
      leaseId: `lease_${randomUUID()}`,
      service: descriptor.service,
      account: descriptor.account,
      scope: [...new Set(descriptor.scope)],
      issuedAt,
      expiresAt: new Date(Date.parse(issuedAt) + ttlMs).toISOString(),
      secret,
    };
    this.leases.set(lease.leaseId, lease);
    return publicLease(lease);
  }

  async deliver(
    leaseId: string,
    destination: string,
    deliverSecret: (secret: string, context: CredentialDeliveryContext) => Promise<void> | void,
  ): Promise<CredentialLease> {
    const lease = this.leases.get(leaseId);
    if (!lease) throw new SecretLeaseError('not_found', 'Credential lease is unavailable');
    const now = Date.parse(this.now());
    if (lease.revokedAt) throw new SecretLeaseError('revoked', 'Credential lease was revoked');
    if (lease.consumedAt) throw new SecretLeaseError('consumed', 'Credential lease was already consumed');
    if (Date.parse(lease.expiresAt) <= now) throw new SecretLeaseError('expired', 'Credential lease expired');
    if (!lease.scope.includes(destination)) throw new SecretLeaseError('invalid_scope', 'Credential destination is outside the lease scope');

    // Consume before invoking the callback so a failing or re-entrant channel
    // cannot replay the secret.
    lease.consumedAt = this.now();
    try {
      await deliverSecret(lease.secret, {
        leaseId: lease.leaseId,
        destination,
        service: lease.service,
        account: lease.account,
        scope: [...lease.scope],
      });
    } catch {
      throw new SecretLeaseError('delivery_failed', 'Credential delivery failed at the effect boundary');
    } finally {
      lease.secret = '';
    }
    return publicLease(lease);
  }

  /** Consume a lease for a host-side proxy or short-lived provider strategy. */
  authorize(leaseId: string, destination: string): CredentialLease {
    const lease = this.leases.get(leaseId);
    if (!lease) throw new SecretLeaseError('not_found', 'Credential lease is unavailable');
    const now = Date.parse(this.now());
    if (lease.revokedAt) throw new SecretLeaseError('revoked', 'Credential lease was revoked');
    if (lease.consumedAt) throw new SecretLeaseError('consumed', 'Credential lease was already consumed');
    if (Date.parse(lease.expiresAt) <= now) throw new SecretLeaseError('expired', 'Credential lease expired');
    if (!lease.scope.includes(destination)) throw new SecretLeaseError('invalid_scope', 'Credential destination is outside the lease scope');
    lease.consumedAt = this.now();
    lease.secret = '';
    return publicLease(lease);
  }

  revoke(leaseId: string): CredentialLease {
    const lease = this.leases.get(leaseId);
    if (!lease) throw new SecretLeaseError('not_found', 'Credential lease is unavailable');
    lease.revokedAt = this.now();
    lease.secret = '';
    return publicLease(lease);
  }

  get(leaseId: string): CredentialLease | undefined {
    const lease = this.leases.get(leaseId);
    return lease ? publicLease(lease) : undefined;
  }
}

function publicLease(lease: ActiveLease): CredentialLease {
  return {
    leaseId: lease.leaseId,
    service: lease.service,
    account: lease.account,
    scope: [...lease.scope],
    issuedAt: lease.issuedAt,
    expiresAt: lease.expiresAt,
  };
}

// In-memory implementation for testing and headless environments.
// Production builds use platform-specific keychain implementations.
export class InMemorySecretBroker implements SecretBroker {
  readonly credentialStore = 'DEVELOPMENT_IN_MEMORY' as const;
  private store = new Map<string, string>();

  private key(service: string, account: string): string {
    return `${service}::${account}`;
  }

  async get(service: string, account: string): Promise<string | null> {
    return this.store.get(this.key(service, account)) ?? null;
  }

  async set(service: string, account: string, secret: string): Promise<void> {
    this.store.set(this.key(service, account), secret);
  }

  async delete(service: string, account: string): Promise<void> {
    this.store.delete(this.key(service, account));
  }

  async list(service: string): Promise<string[]> {
    const prefix = `${service}::`;
    return [...this.store.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }
}

export interface NativeKeyringEntry {
  getPassword(): Promise<string | null>;
  setPassword(secret: string): Promise<void>;
  deletePassword(): Promise<void>;
}

export type NativeKeyringEntryFactory = new (service: string, account: string) => NativeKeyringEntry;

/** Production broker backed by the platform keyring through @napi-rs/keyring. */
export class OsKeyringSecretBroker implements SecretBroker {
  readonly credentialStore = 'OS_BACKED' as const;
  private readonly [PRODUCTION_CREDENTIAL_STORE_BRAND]: boolean;

  constructor(private readonly Entry: NativeKeyringEntryFactory, productionCapability?: symbol) {
    this[PRODUCTION_CREDENTIAL_STORE_BRAND] = productionCapability === PRODUCTION_CREDENTIAL_STORE_BRAND;
  }

  async get(service: string, account: string): Promise<string | null> {
    return this.entry(service, account).getPassword();
  }

  async set(service: string, account: string, secret: string): Promise<void> {
    await this.entry(service, account).setPassword(secret);
  }

  async delete(service: string, account: string): Promise<void> {
    await this.entry(service, account).deletePassword();
  }

  /** OS keyrings intentionally do not expose account enumeration here. */
  async list(_service: string): Promise<string[]> { return []; }

  private entry(service: string, account: string): NativeKeyringEntry {
    if (!service.trim() || !account.trim()) throw new SecretLeaseError('invalid_scope', 'Keyring service and account are required');
    try { return new this.Entry(service, account); } catch { throw new SecretLeaseError('unavailable', 'OS-backed credential store is unavailable'); }
  }
}

/** Only the production factory-created broker carries this capability. */
export function isProductionSecretBroker(value: SecretBroker): boolean {
  if (!(value instanceof OsKeyringSecretBroker)) return false;
  return value[PRODUCTION_CREDENTIAL_STORE_BRAND] === true;
}

/** Strict runtimes call this factory; failure means credential capability is unavailable. */
export async function createProductionSecretBroker(): Promise<OsKeyringSecretBroker> {
  try {
    const keyring = await import('@napi-rs/keyring');
    const broker = new OsKeyringSecretBroker(keyring.Entry as unknown as NativeKeyringEntryFactory, PRODUCTION_CREDENTIAL_STORE_BRAND);
    await broker.get('fates-probe', 'availability-probe');
    return broker;
  } catch {
    throw new SecretLeaseError('unavailable', 'OS-backed credential store is unavailable');
  }
}
