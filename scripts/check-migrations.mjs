import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { migrationSha256 } from './migration-hash.mjs';

const root = process.cwd();
const dir = path.join(root, 'supabase', 'migrations');
const manifest = JSON.parse(await readFile(path.join(root, 'supabase', 'applied-migration-sha256.json'), 'utf8'));
const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
const prefixes = new Set();
for (const file of files) {
  const match = /^(\d{12})_[a-z0-9_]+\.sql$/.exec(file);
  if (!match) throw new Error(`Invalid migration filename: ${file}`);
  if (prefixes.has(match[1])) throw new Error(`Duplicate migration prefix: ${match[1]}`);
  prefixes.add(match[1]);
}
for (const [file, expected] of Object.entries(manifest)) {
  if (!files.includes(file)) throw new Error(`Applied migration missing: ${file}`);
  const actual = migrationSha256(await readFile(path.join(dir, file)));
  if (actual !== expected) throw new Error(`Applied migration changed: ${file}`);
}
console.log(`Migration contract valid: ${files.length} ordered, ${Object.keys(manifest).length} immutable.`);
