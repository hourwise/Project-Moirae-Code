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

export interface SecretBroker {
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

// In-memory implementation for testing and headless environments.
// Production builds use platform-specific keychain implementations.
export class InMemorySecretBroker implements SecretBroker {
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
