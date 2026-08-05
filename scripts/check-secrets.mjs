import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['OpenAI key', /\bsk-(?!your|replace)[A-Za-z0-9_-]{32,}\b/],
  ['GitHub token', /\bgh[opusr]_[A-Za-z0-9]{36,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/],
];
const findings = [];
for (const file of files) {
  if (/\.(?:png|jpe?g|ico|woff2?|lock)$/i.test(file)) continue;
  let source;
  try { source = await readFile(file, 'utf8'); } catch { continue; }
  for (const [name, pattern] of rules) if (pattern.test(source)) findings.push(`${file}: ${name}`);
}
if (findings.length) throw new Error(`Potential committed secrets detected:\n${findings.join('\n')}`);
console.log(`Secret scan passed for ${files.length} tracked files.`);
