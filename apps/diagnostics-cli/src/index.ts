#!/usr/bin/env node
/** Sanitized Stage-A evidence CLI; it never inspects credentials or environments. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FatesInspectionCoordinator } from '@moirae/fates-inspection';
import { ADRASTEIA_BASELINE, negotiateWithMoirae } from '@moirae/adrasteia-adapter';

const version = '0.1.0';
const baselinePath = resolve(process.cwd(), 'docs', 'integration', 'adrasteia-baseline.json');
const readBaseline = async () =>
  JSON.parse(await readFile(baselinePath, 'utf8')) as Record<string, unknown>;
const print = (value: unknown, pretty = true) =>
  console.log(JSON.stringify(value, null, pretty ? 2 : undefined));

async function inspect(): Promise<void> {
  const report = await new FatesInspectionCoordinator({
    version,
    instanceId: `moirae-diag-${process.pid}`,
    startedAt: Date.now(),
    peers: [],
  }).inspect();
  print(report);
}

async function verifyAdrasteia(): Promise<void> {
  const baseline = await readBaseline();
  const adrasteia = baseline['adrasteia'] as Record<string, unknown>;
  const valid =
    adrasteia['package'] === ADRASTEIA_BASELINE.packageName &&
    adrasteia['version'] === ADRASTEIA_BASELINE.packageVersion &&
    adrasteia['sha256'] === ADRASTEIA_BASELINE.artifactSha256;
  print({
    valid,
    package: ADRASTEIA_BASELINE.packageName,
    version: ADRASTEIA_BASELINE.packageVersion,
    protocol: ADRASTEIA_BASELINE.protocolVersion,
    contentPreflightIncluded: adrasteia['contentPreflightIncluded'],
  });
  if (!valid) process.exitCode = 1;
}

async function verifyPeers(): Promise<void> {
  const baseline = await readBaseline();
  const peers = baseline['peers'] as Record<string, Record<string, string>>;
  const expected = ['ananke', 'mnemosyne', 'horae'];
  const verified = expected.map((name) => ({
    runtime: name,
    tag: peers[name]?.['tag'],
    commit: peers[name]?.['commit'],
    inspectionOnly: true,
    valid: Boolean(peers[name]?.['tag'] && peers[name]?.['commit']),
  }));
  print({ valid: verified.every((peer) => peer.valid), peers: verified });
  if (!verified.every((peer) => peer.valid)) process.exitCode = 1;
}

async function governanceBoundary(): Promise<void> {
  print({
    inspectionOnly: true,
    proposalBoundary: true,
    unavailable: [
      'Ananke execution and approval',
      'Mnemosyne retrieval',
      'Horae session orchestration',
      'sandbox execution',
      'content preflight',
    ],
    ungoverned: [
      'terminal',
      'built-in Git',
      'debugger and tasks',
      'third-party extensions',
      'direct provider paths',
    ],
  });
}

async function protocol(): Promise<void> {
  print({
    protocol: '1.4.0',
    minimum: '1.0.0',
    maximum: '1.4.0',
    selfNegotiation: negotiateWithMoirae({
      runtime: 'moirae-code',
      version,
      protocolVersion: '1.4.0',
      minimumProtocolVersion: '1.0.0',
    }),
  });
}

const [command = 'help', option] = process.argv.slice(2);
const handlers: Record<string, () => Promise<void>> = {
  inspect,
  'verify-adrasteia': verifyAdrasteia,
  'verify-peers': verifyPeers,
  'governance-boundary': governanceBoundary,
  protocol,
};
if (command === 'help' || !handlers[command]) {
  console.log(
    'moirae-diag commands: inspect --json, verify-adrasteia, verify-peers, governance-boundary, protocol',
  );
  if (command !== 'help') process.exitCode = 1;
} else {
  void handlers[command]();
}
