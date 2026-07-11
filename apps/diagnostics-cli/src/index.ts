#!/usr/bin/env node
/**
 * @moirae/diagnostics-cli — Environment validation and component health checks.
 *
 * Usage: npx moirae-diag [check|status|env|collect]
 */

import * as os from 'node:os';

interface DiagReport {
  timestamp: string;
  environment: {
    os: string;
    osRelease: string;
    arch: string;
    node: string;
    cpus: number;
    memoryMb: number;
  };
  moirae: {
    version: string;
    components: string[];
  };
}

function runDiagnostics(): DiagReport {
  return {
    timestamp: new Date().toISOString(),
    environment: {
      os: os.type(),
      osRelease: os.release(),
      arch: os.arch(),
      node: process.version,
      cpus: os.cpus().length,
      memoryMb: Math.round(os.totalmem() / (1024 * 1024)),
    },
    moirae: {
      version: '0.1.0',
      components: ['runtime-contracts', 'supervisor', 'local-ipc'],
    },
  };
}

const command = process.argv[2] ?? 'check';

switch (command) {
  case 'check':
  case 'status':
  case 'env':
    console.log(JSON.stringify(runDiagnostics(), null, 2));
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Available: check, status, env, collect');
    process.exitCode = 1;
}
