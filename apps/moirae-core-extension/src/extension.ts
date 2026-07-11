/**
 * Moirae Code — VS Code Extension entry point.
 *
 * Provides: chat surface, model selector, memory explorer (Mnemosyne),
 * approval UX (Ananke), audit timeline, runtime health dashboard,
 * project onboarding, and configuration UI.
 *
 * Communicates with the Moirae Supervisor via local IPC.
 */

import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  console.log('[moirae] Extension activating...');

  // Register the Moirae views container and sidebar views.
  // Full implementation in Phase 2.

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('moirae.thread', new ThreadProvider()),
    vscode.window.registerTreeDataProvider('moirae.memory', new MemoryProvider()),
    vscode.window.registerTreeDataProvider('moirae.authority', new AuthorityProvider()),
    vscode.window.registerTreeDataProvider('moirae.runtime', new RuntimeProvider()),
  );

  console.log('[moirae] Extension activated.');
}

export function deactivate(): void {
  console.log('[moirae] Extension deactivated.');
}

// ── Placeholder TreeDataProviders ───────────────────────────

class ThreadProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
  getChildren(): vscode.TreeItem[] {
    return [new vscode.TreeItem('No active workflow', vscode.TreeItemCollapsibleState.None)];
  }
}

class MemoryProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
  getChildren(): vscode.TreeItem[] {
    return [new vscode.TreeItem('Mnemosyne not connected', vscode.TreeItemCollapsibleState.None)];
  }
}

class AuthorityProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
  getChildren(): vscode.TreeItem[] {
    return [new vscode.TreeItem('Ananke not connected', vscode.TreeItemCollapsibleState.None)];
  }
}

class RuntimeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
  getChildren(): vscode.TreeItem[] {
    return [new vscode.TreeItem('Supervisor not connected', vscode.TreeItemCollapsibleState.None)];
  }
}
