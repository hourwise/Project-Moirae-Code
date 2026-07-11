/**
 * @moirae/ui-components — Shared UI components for Moirae Code webviews.
 *
 * Phase 1 IDE surfaces (from research doc):
 *   - TaskPanel: active task, status, planned actions, blockers
 *   - ExecutionLog: chronological audit stream per task
 *   - EvidenceViewer: diff review, command output, test results, side effects
 *   - SkillRegistryBrowser: skill import, trust, install, update, rollback
 *   - ModelProviderSelector: model per message, defaults, fallback, locality
 *   - GovernanceHeader: chat header showing active model/route/policy/memory/network
 *
 * These render inside VS Code webviews using React.
 */

export const UI_VERSION = '0.1.0';

export type {
  TaskInfo,
  TaskStatus,
  PlannedAction,
  CompletedAction,
  TaskPanelProps,
  ExecutionLogEntry,
  ExecutionLogEntryType,
  ExecutionLogProps,
  EvidenceItem,
  EvidenceType,
  DiffEvidence,
  DiffHunk,
  DiffLine,
  CommandOutputEvidence,
  TestResultsEvidence,
  FileChangeEvidence,
  GitOperationEvidence,
  SideEffectSummaryEvidence,
  AnyEvidence,
  EvidenceViewerProps,
  SkillRegistryBrowserProps,
  SkillDisplayInfo,
  ModelProviderSelectorProps,
  ProviderDisplayInfo,
  ModelDisplayInfo,
  GovernanceHeaderProps,
  MoiraeComponentProps,
} from './components.js';
