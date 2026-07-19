import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const url =
  'https://github.com/hourwise/Project-Adrasteia/releases/download/adrasteia-adoption-v0.4.0-protocol-1.4.0/project-runtime-contracts-0.4.0.tgz';
const digest = '11ee062b079f74d2a4558af315c9b9b12a6aede291d409c48f038d93c416e2c2';
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const installed = JSON.parse(
  await readFile(
    new URL('../node_modules/project-runtime-contracts/package.json', import.meta.url),
    'utf8',
  ),
);
if (root.dependencies?.['project-runtime-contracts'] !== url)
  throw new Error('Root dependency is not the immutable Adrasteia release URL.');
const entry = lock.packages?.['node_modules/project-runtime-contracts'];
if (!entry || entry.resolved !== url || String(entry.resolved).startsWith('file:'))
  throw new Error(
    'Lockfile does not resolve project-runtime-contracts to the immutable release URL.',
  );
if (installed.name !== 'project-runtime-contracts' || installed.version !== '0.4.0')
  throw new Error('Installed Project Adrasteia package name/version differs.');
const response = await fetch(url);
if (!response.ok)
  throw new Error(`Could not fetch immutable Adrasteia artifact: HTTP ${response.status}`);
const actual = createHash('sha256')
  .update(Buffer.from(await response.arrayBuffer()))
  .digest('hex');
if (actual !== digest) throw new Error(`Immutable Adrasteia digest mismatch: ${actual}`);
console.log(
  JSON.stringify({
    verified: true,
    package: installed.name,
    version: installed.version,
    url,
    sha256: actual,
    protocol: '1.4.0',
    minimum: '1.0.0',
    range: '1.0.0-1.4.0',
    contentPreflightIncluded: false,
  }),
);
