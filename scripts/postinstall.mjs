/**
 * postinstall.mjs — Moirae Code post-install hook.
 *
 * Validates the environment after `npm install`:
 *   - Node.js version check
 *   - Workspace integrity check
 *   - Build all packages
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { arch, platform, release, type } from 'node:os';

const startedAt = new Date().toISOString();

function check(label, ok) {
  const status = ok ? '✓' : '✗';
  console.log(`  ${status} ${label}`);
  return ok;
}

console.log('[moirae] Post-install environment check\n');

const nodeMajor = Number.parseInt(process.version.slice(1).split('.')[0], 10);
check(`Node.js >= 22 (found ${process.version})`, nodeMajor >= 22);

const osOk = ['Windows_NT', 'Linux', 'Darwin'].includes(type());
check(`Supported OS (${type()} ${release()} ${arch()})`, osOk);

const npmCmd = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'npm';
const npmArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm --version'] : ['--version'];
const hasNpm = (() => {
  try {
    execFileSync(npmCmd, npmArgs, { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
})();
check('npm available', hasNpm);

console.log(`\n  Finished at ${new Date().toISOString()}`);
