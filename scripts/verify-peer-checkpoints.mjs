import { execFileSync } from 'node:child_process';

const peers = [
  [
    'ananke',
    'https://github.com/hourwise/Project-Ananke.git',
    'ananke-adrasteia-adoption-v0.1.0-protocol-1.4.0',
    'dcbb115c5798072221afdd2e4fdd36e786defddf',
  ],
  [
    'mnemosyne',
    'https://github.com/hourwise/Project-Mnemosyne.git',
    'mnemosyne-adrasteia-adoption-v0.1.0-protocol-1.4.0',
    'f4ab76a9760f856d78908d35facceb068d78c8e5',
  ],
  [
    'horae',
    'https://github.com/hourwise/Project-Horae.git',
    'horae-adrasteia-adoption-v0.1.0-protocol-1.4.0',
    '52e14fa574f7427f62747fe84d2789aec25b94e3',
  ],
];
for (const [runtime, repository, tag, commit] of peers) {
  const result = execFileSync('git', ['ls-remote', '--tags', repository, `${tag}^{}`], {
    encoding: 'utf8',
  }).trim();
  const actual = result.split(/\s+/)[0];
  if (actual !== commit) throw new Error(`${runtime} checkpoint mismatch: ${actual || 'missing'}`);
  console.log(JSON.stringify({ verified: true, runtime, tag, commit, inspectionOnly: true }));
}
