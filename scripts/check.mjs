import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Check only this integration's owned source trees; never rewrite other work.
const roots = ['service', 'test', 'scripts', 'docs/integration', 'docs/production'];
let checked = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name !== entry.name.normalize('NFC')) throw new Error(`Non-NFC name: ${path.join(dir, entry.name)}`);
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { await walk(file); continue; }
    if (!entry.isFile()) throw new Error(`Unsupported source entry: ${file}`);
    const text = await readFile(file, 'utf8');
    if (text.includes('\r') || /[\t ]+$/m.test(text) || !text.endsWith('\n')) throw new Error(`Whitespace issue: ${file}`);
    if (/\.(mjs|js)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`JavaScript syntax check failed: ${file}`);
    }
    checked++;
  }
}
for (const root of roots) await walk(root);
process.stdout.write(`Checked ${checked} integration files: syntax, whitespace and NFC names.\n`);
