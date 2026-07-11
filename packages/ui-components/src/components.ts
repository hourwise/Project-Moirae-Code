/**
 * @moirae/ui-components — IDE Surface Component Interfaces
 *
 * Phase 1 IDE surfaces from the research doc:
 *   - TaskPanel: active task, status, planned actions, blockers, token/cost/privacy
 *   - ExecutionLog: chronological audit stream per task
 *   - EvidenceViewer: diff review, command output, test results, side-effect summary
 *   - SkillRegistryBrowser: installed, pending, blocked skills with trust states
 *   - ModelProviderSelector: model per message, defaults, fallback chains, locality
 *
 * These are React component interfaces — the actual rendering is implemented
 * in the VS Code extension webviews during Phase 1.
 */

import type { ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════════
// SHARED PROPS
// ═══════════════════════════════════════════════════════════════

export interface MoiraeComponentProps {
  /** Optional CSS class name. */
  className?: string;
  /** Theme variant from VS Code. */
  theme?: 'dark' | 'light' | 'high-contrast';
}

// ═══════════════════════════════════════════════════════════════
// TASK PANEL
// ═══════════════════════════════════════════════════════════════

export interface TaskInfo {
  id: string;
  summary: string;
  status: TaskStatus;
  activeModel: string;
  activeProvider: string;
  locality: 'local' | 'remote';
  currentStage: string;
  plannedActions: PlannedAction[];
  completedActions: CompletedAction[];
  blockers: string[];
  tokenUsage: { used: number; limit: number };
  estimatedCost: string;
  privacy: 'local-only' | 'restricted' | 'standard';
  createdAt: string;
  updatedAt: string;
}

export enum TaskStatus {
  Planning = 'planning',
  AwaitingApproval = 'awaiting_approval',
  Running = 'running',
  Paused = 'paused',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export interface PlannedAction {
  id: string;
  description: string;
  tool: string;
  riskClass: string;
  requiresApproval: boolean;
  status: 'pending' | 'approved' | 'denied' | 'executing';
}

export interface CompletedAction {
  id: string;
  description: string;
  tool: string;
  outcome: string;
  durationMs: number;
  evidenceRef: string;
}

export interface TaskPanelProps extends MoiraeComponentProps {
  task: TaskInfo | null;
  onApprove: (actionId: string) => void;
  onDeny: (actionId: string) => void;
  onApproveAll: () => void;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
}

// ═══════════════════════════════════════════════════════════════
// EXECUTION LOG
// ═══════════════════════════════════════════════════════════════

export interface ExecutionLogEntry {
  id: string;
  timestamp: string;
  type: ExecutionLogEntryType;
  source: string;
  summary: string;
  details: string;
  outcome?: string;
  evidenceRef?: string;
  correlationId?: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

export enum ExecutionLogEntryType {
  SessionStarted = 'session_started',
  ContextPrepared = 'context_prepared',
  ModelSelected = 'model_selected',
  ModelOutputReceived = 'model_output_received',
  ToolProposed = 'tool_proposed',
  ApprovalRequested = 'approval_requested',
  ApprovalResolved = 'approval_resolved',
  ToolStarted = 'tool_started',
  ToolCompleted = 'tool_completed',
  MemoryProposed = 'memory_proposed',
  MemoryAccepted = 'memory_accepted',
  OutcomeProduced = 'outcome_produced',
  SessionCancelled = 'session_cancelled',
  SkillInvoked = 'skill_invoked',
  WorkerInstantiated = 'worker_instantiated',
  WorkerReleased = 'worker_released',
}

export interface ExecutionLogProps extends MoiraeComponentProps {
  entries: ExecutionLogEntry[];
  filter?: {
    types?: ExecutionLogEntryType[];
    severity?: string[];
    source?: string;
    from?: string;
    to?: string;
  };
  onFilterChange: (filter: ExecutionLogProps['filter']) => void;
  onEntryClick: (entry: ExecutionLogEntry) => void;
  loading: boolean;
}

// ═══════════════════════════════════════════════════════════════
// EVIDENCE VIEWER
// ═══════════════════════════════════════════════════════════════

export interface EvidenceItem {
  id: string;
  actionId: string;
  type: EvidenceType;
  title: string;
  summary: string;
  timestamp: string;
}

export enum EvidenceType {
  Diff = 'diff',
  CommandOutput = 'command_output',
  TestResults = 'test_results',
  FileChange = 'file_change',
  GitOperation = 'git_operation',
  SideEffectSummary = 'side_effect_summary',
}

export interface DiffEvidence extends EvidenceItem {
  type: EvidenceType.Diff;
  filePath: string;
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'added' | 'removed';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface CommandOutputEvidence extends EvidenceItem {
  type: EvidenceType.CommandOutput;
  command: string;
  workingDirectory: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface TestResultsEvidence extends EvidenceItem {
  type: EvidenceType.TestResults;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: Array<{ test: string; message: string }>;
}

export interface FileChangeEvidence extends EvidenceItem {
  type: EvidenceType.FileChange;
  filePath: string;
  changeType: 'created' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
}

export interface GitOperationEvidence extends EvidenceItem {
  type: EvidenceType.GitOperation;
  operation: 'commit' | 'branch' | 'push' | 'merge' | 'rebase';
  repository: string;
  branch: string;
  commitHash?: string;
  message: string;
}

export interface SideEffectSummaryEvidence extends EvidenceItem {
  type: EvidenceType.SideEffectSummary;
  filesChanged: number;
  filesCreated: number;
  filesDeleted: number;
  commandsRun: number;
  testsRun: number;
  networkCalls: number;
  affectedResources: string[];
}

export type AnyEvidence =
  | DiffEvidence
  | CommandOutputEvidence
  | TestResultsEvidence
  | FileChangeEvidence
  | GitOperationEvidence
  | SideEffectSummaryEvidence;

export interface EvidenceViewerProps extends MoiraeComponentProps {
  evidence: AnyEvidence | null;
  onClose: () => void;
  onApprove?: () => void;
  onDeny?: () => void;
  /** Whether this evidence is part of a pending approval review. */
  isApprovalReview?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// SKILL REGISTRY BROWSER
// ═══════════════════════════════════════════════════════════════

export interface SkillRegistryBrowserProps extends MoiraeComponentProps {
  skills: SkillDisplayInfo[];
  filter?: {
    kind?: string[];
    trustState?: string[];
    publisher?: string;
    search?: string;
  };
  onFilterChange: (filter: SkillRegistryBrowserProps['filter']) => void;
  onImport: () => void;
  onInspect: (skillId: string) => void;
  onTrust: (skillId: string) => void;
  onInstall: (skillId: string) => void;
  onPin: (skillId: string) => void;
  onUpdate: (skillId: string) => void;
  onRollback: (skillId: string) => void;
  onRemove: (skillId: string) => void;
}

export interface SkillDisplayInfo {
  id: string;
  name: string;
  kind: 'guidance' | 'workflow' | 'executable';
  version: string;
  publisher: string;
  trustState: string;
  active: boolean;
  pinned: boolean;
  riskScore: number;
  updateCount: number;
  importedAt: string;
  performance: {
    total: number;
    successRate: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// MODEL / PROVIDER SELECTOR
// ═══════════════════════════════════════════════════════════════

export interface ModelProviderSelectorProps extends MoiraeComponentProps {
  providers: ProviderDisplayInfo[];
  selectedModelId: string | null;
  defaultModelId: string | null;
  fallbackChain: string[];
  onSelectModel: (modelId: string) => void;
  onSetDefault: (modelId: string) => void;
  onConfigureFallback: (chain: string[]) => void;
  maxCost: number | null;
  onSetMaxCost: (cost: number | null) => void;
  localOnly: boolean;
  onSetLocalOnly: (value: boolean) => void;
}

export interface ProviderDisplayInfo {
  id: string;
  name: string;
  locality: 'local' | 'remote';
  models: ModelDisplayInfo[];
  available: boolean;
  latencyMs: number;
}

export interface ModelDisplayInfo {
  id: string;
  name: string;
  contextLimit: number;
  supportsTools: boolean;
  supportsImages: boolean;
  capabilities: string[];
}

// ═══════════════════════════════════════════════════════════════
// GOVERNANCE STATUS HEADER (chat header)
// ═══════════════════════════════════════════════════════════════

export interface GovernanceHeaderProps extends MoiraeComponentProps {
  model: string;
  provider: string;
  route: string;
  policy: string;
  memory: string;
  network: string;
  tools: { permitted: number; total: number };
  taskId?: string;
  sessionId?: string;
}
