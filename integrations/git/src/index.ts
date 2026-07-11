/**
 * @moirae/git-adapter — Typed Git operations behind Ananke governance.
 *
 * Distinguishes: workspace.write → git.commit → github.branch.push
 * Each is a separate capability with separate risk and approval rules.
 * Unrestricted shell access is NOT a substitute for typed Git routes.
 */

export interface GitStatus {
  branch: string;
  clean: boolean;
  ahead: number;
  behind: number;
  changed: string[];
  staged: string[];
  untracked: string[];
}

export interface GitAdapterConfig {
  workspaceRoot: string;
}

export class GitAdapter {
  constructor(private config: GitAdapterConfig) {}

  // Placeholder — to be implemented with governed Git CLI execution.
  // All operations go through Ananke's tool router, not direct shell access.
  async status(): Promise<GitStatus> { throw new Error('Not implemented'); }
  async commit(message: string, files?: string[]): Promise<string> { throw new Error('Not implemented'); }
  async branch(name: string): Promise<void> { throw new Error('Not implemented'); }
  async diff(staged?: boolean): Promise<string> { throw new Error('Not implemented'); }
}
