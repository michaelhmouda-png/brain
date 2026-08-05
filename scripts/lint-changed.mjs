import { execFileSync } from 'node:child_process';

function output(args) { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }
let base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'HEAD~1';
try { output(['rev-parse', '--verify', base]); } catch { base = output(['rev-list', '--max-parents=0', 'HEAD']); }
const changed = output(['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`])
  .split(/\r?\n/).filter((file) => /\.(?:js|mjs|cjs|ts|tsx)$/.test(file));
if (!changed.length) { console.log('No changed JavaScript or TypeScript files.'); process.exit(0); }
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['eslint', ...changed], { stdio: 'inherit' });
