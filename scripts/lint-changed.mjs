import { execFileSync } from 'node:child_process';
import path from 'node:path';

function output(args) { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }
let base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}`
  : process.env.GITHUB_ACTIONS === 'true' ? 'HEAD~1' : 'HEAD';
try { output(['rev-parse', '--verify', base]); } catch { base = output(['rev-list', '--max-parents=0', 'HEAD']); }
const candidates = new Set([
  ...output(['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`]).split(/\r?\n/),
  ...output(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']).split(/\r?\n/),
  ...output(['diff', '--cached', '--name-only', '--diff-filter=ACMR']).split(/\r?\n/),
  ...output(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/),
]);
const changed = [...candidates].filter((file) => /\.(?:js|mjs|cjs|ts|tsx)$/.test(file)).sort();
if (!changed.length) { console.log('No changed JavaScript or TypeScript files.'); process.exit(0); }
const eslint = path.join(process.cwd(), 'node_modules', 'eslint', 'bin', 'eslint.js');
execFileSync(process.execPath, [eslint, ...changed], { stdio: 'inherit' });
