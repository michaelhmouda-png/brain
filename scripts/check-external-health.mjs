const candidate = process.env.BRAIN_HEALTH_URL ?? process.argv[2];
let target;
try { target = new URL(candidate); } catch { throw new Error('HEALTH_TARGET_INVALID'); }
if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/api/health' || target.search || target.hash) throw new Error('HEALTH_TARGET_INVALID');
const response = await fetch(target, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
const body = await response.json().catch(() => null);
if (response.status !== 200 || !body || body.status !== 'ok' || body.code !== 'BRAIN_HEALTHY') throw new Error('BRAIN_EXTERNAL_HEALTH_FAILED');
console.log('External health contract valid: BRAIN_HEALTHY.');
