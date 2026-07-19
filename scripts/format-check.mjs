import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const scope = [
  'README.md',
  'eslint.config.mjs',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  '.github/workflows/ci.yml',
  'docs/decisions/README.md',
  'docs/decisions/ADR-0001-project-adrasteia-stage-a-host-boundary.md',
  'docs/integration/adrasteia-baseline.json',
  'docs/integration/stage-a-host-adoption.md',
  'packages/host-contracts',
  'packages/adrasteia-adapter',
  'packages/fates-inspection',
  'packages/runtime-contracts/package.json',
  'packages/runtime-contracts/src/index.ts',
  'packages/runtime-contracts/tsconfig.json',
  'packages/local-ipc/package.json',
  'packages/local-ipc/src/index.ts',
  'packages/local-ipc/tsconfig.json',
  'packages/provider-sdk/package.json',
  'packages/provider-sdk/src/index.ts',
  'packages/provider-sdk/tsconfig.json',
  'packages/supervisor/package.json',
  'packages/supervisor/src/index.ts',
  'packages/supervisor/tsconfig.json',
  'packages/sandbox-adapter/src/adapter.ts',
  'packages/sandbox-adapter/src/types.ts',
  'packages/skill-registry/src/registry.ts',
  'packages/skill-registry/src/types.ts',
  'integrations/ananke-client',
  'integrations/anthropic/src/index.ts',
  'integrations/deepseek/src/index.ts',
  'integrations/google/src/index.ts',
  'integrations/horae-client',
  'integrations/llama-cpp/src/index.ts',
  'integrations/mistral/src/index.ts',
  'integrations/mnemosyne-client',
  'integrations/openai-compatible/src/index.ts',
  'apps/diagnostics-cli',
  'apps/moirae-core-extension/src/extension.ts',
  'scripts/verify-adrasteia.mjs',
  'scripts/verify-peer-checkpoints.mjs',
  'tests/contract/provider-adapters.test.ts',
  'tests/contract/runtime-contracts.test.ts',
  'tests/contract/sandbox-adapter.test.ts',
  'tests/contract/supervisor.test.ts',
  'tests/stage-a',
];

const files = scope.filter((path) => existsSync(path));
const prettier = fileURLToPath(new URL('../node_modules/prettier/bin/prettier.cjs', import.meta.url));
execFileSync(process.execPath, [prettier, '--check', ...files], {
  stdio: 'inherit',
});
