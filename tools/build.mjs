// Prepares a deploy:
// 1. lists the recorded numbers in sounds/index.json, so the app and the service worker know them;
// 2. checks every file the service worker caches exists;
// 3. stamps sw.js with a hash of everything it caches, so phones pick up the new version.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const at = (path) => new URL(path, root);

const wavs = (await readdir(at('sounds/'))).filter((name) => /^\d+\.wav$/.test(name));
const numbers = wavs.map((name) => parseInt(name, 10)).sort((a, b) => a - b);
await writeFile(at('sounds/index.json'), JSON.stringify(numbers) + '\n');

const sw = await readFile(at('sw.js'), 'utf8');
const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)]
  .map((m) => m[1])
  .filter((path) => path !== './');
const missing = shell.filter((path) => !existsSync(at(path)));
if (missing.length) {
  console.error(`sw.js caches files that don't exist: ${missing.join(', ')}`);
  process.exit(1);
}

const hash = createHash('sha256');
for (const path of [...shell, ...numbers.map((n) => `sounds/${n}.wav`)]) {
  hash.update(path);
  hash.update(await readFile(at(path)));
}
const version = hash.digest('hex').slice(0, 12);
await writeFile(at('sw.js'), sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`));

console.log(`${numbers.length} sounds (${numbers[0] ?? '-'} to ${numbers.at(-1) ?? '-'}), service worker version ${version}`);
