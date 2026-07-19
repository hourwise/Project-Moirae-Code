/** Narrow Stage-A read-only inspection surface. It does not provide approval, memory, or execution UX. */
import * as vscode from 'vscode';

const stageALines: Record<string, string[]> = {
  'moirae.thread': [
    'Stage-A inspection only',
    'No governed chat or workflow is implemented.',
    'Model tool calls are captured as proposals only.',
  ],
  'moirae.memory': [
    'Mnemosyne: inspection-only',
    'Qualified-context retrieval and memory browsing are unavailable.',
  ],
  'moirae.authority': [
    'Ananke: inspection-only',
    'No approval panel or approval decision path is implemented.',
  ],
  'moirae.runtime': [
    'Project Moirae Code · runtime: moirae-code · protocol: 1.4.0',
    'Fates integration: inspection-only; availability is configured-peer dependent.',
    'Ungoverned: terminal, built-in Git, debugger/tasks, third-party extensions, and direct provider paths.',
    'Unavailable: governed handoff, memory retrieval, Horae orchestration, sandbox execution, and content preflight.',
  ],
};

class StageAInspectionProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  constructor(private readonly viewId: string) {}
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }
  getChildren(): vscode.TreeItem[] {
    return (stageALines[this.viewId] ?? []).map(
      (line) => new vscode.TreeItem(line, vscode.TreeItemCollapsibleState.None),
    );
  }
}

export function activate(context: vscode.ExtensionContext): void {
  for (const viewId of Object.keys(stageALines)) {
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider(viewId, new StageAInspectionProvider(viewId)),
    );
  }
}

export function deactivate(): void {}
