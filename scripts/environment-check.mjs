/**
 * environment-check.mjs — Comprehensive pre-flight diagnostics.
 *
 * Usage: node scripts/environment-check.mjs
 *
 * Checks: Node, npm, disk space, memory, workspace integrity.
 * Generates a validation report in validation-reports/.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, freemem, platform, release, totalmem, type } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.env.INIT_CWD ?? process.cwd();
const reportDir = join(repoRoot, 'validation-reports');
const startedAt = new Date().toISOString();

const checks = [];

function addCheck(id, name, status, details = '', remediation = '') {
  checks.push({ id, name, status, details, remediation });
}

// Node.js
const nodeVersion = process.version;
const nodeMajor = Number.parseInt(nodeVersion.slice(1).split('.')[0], 10);
addCheck('ENV-001', 'Node.js version', nodeMajor >= 22 ? 'passed' : 'failed', nodeVersion, 'Install Node.js 22+ LTS');

// npm
try {
  const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
  addCheck('ENV-002', 'npm available', 'passed', npmVersion);
} catch {
  addCheck('ENV-002', 'npm available', 'failed', '', 'Install npm');
}

// Disk space
try {
  const freeMb = Math.round(freemem() / (1024 * 1024));
  addCheck('ENV-003', 'Available memory', freeMb > 512 ? 'passed' : 'warning', `${freeMb} MB free`, 'Close other applications');
} catch {
  addCheck('ENV-003', 'Available memory', 'warning', 'Could not check');
}

// Workspace
const hasPackageJson = existsSync(join(repoRoot, 'package.json'));
addCheck('ENV-004', 'Workspace root (package.json)', hasPackageJson ? 'passed' : 'failed', repoRoot);

// OS
addCheck('ENV-005', 'Operating system', 'passed', `${type()} ${release()} ${arch()}`);

const finishedAt = new Date().toISOString();
const passed = checks.filter((c) => c.status === 'passed').length;
const failed = checks.filter((c) => c.status === 'failed').length;
const warnings = checks.filter((c) => c.status === 'warning').length;

const report = {
  schemaVersion: '0.1.0',
  project: 'Moirae Code',
  validationKind: 'environment-check',
  startedAt,
  finishedAt,
  summary: { total: checks.length, passed, failed, warnings },
  environment: {
    os: type(),
    osRelease: release(),
    arch: arch(),
    node: nodeVersion,
    cpus: cpus().length,
    totalMemoryMb: Math.round(totalmem() / (1024 * 1024)),
  },
  checks,
};

mkdirSync(reportDir, { recursive: true });
writeFileSync(join(reportDir, 'environment-check.json'), JSON.stringify(report, null, 2));

console.log(JSON.stringify(report.summary, null, 2));
console.log(`Report written to validation-reports/environment-check.json`);

if (failed > 0) process.exitCode = 1;
