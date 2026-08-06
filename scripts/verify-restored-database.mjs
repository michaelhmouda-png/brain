import { spawnSync } from 'node:child_process';

const target = process.env.RESTORE_TARGET_DATABASE_URL;
if (!target) throw new Error('RESTORE_TARGET_DATABASE_URL_MISSING');
let database;
try { database = new URL(target); } catch { throw new Error('RESTORE_TARGET_DATABASE_URL_INVALID'); }
const environment = {
  ...process.env,
  PGHOST: database.hostname,
  PGPORT: database.port || '5432',
  PGUSER: decodeURIComponent(database.username),
  PGPASSWORD: decodeURIComponent(database.password),
  PGDATABASE: decodeURIComponent(database.pathname.replace(/^\//,'')),
  PGSSLMODE: database.searchParams.get('sslmode') ?? 'require',
};
const sql = `
DO $$ BEGIN
  IF to_regclass('public.companies') IS NULL OR to_regclass('public.profiles') IS NULL
    OR to_regclass('public.tasks') IS NULL OR to_regclass('public.system_worker_runs') IS NULL
    OR to_regprocedure('public.get_system_worker_health_v1()') IS NULL THEN
    RAISE EXCEPTION 'RESTORE_CATALOG_INCOMPLETE';
  END IF;
END $$;
SELECT 'RESTORE_VERIFIED';`;
const result = spawnSync('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--command', sql], { env: environment, encoding: 'utf8', shell: false, windowsHide: true });
if (result.status !== 0 || !result.stdout.includes('RESTORE_VERIFIED')) throw new Error('RESTORE_VERIFICATION_FAILED');
console.log('Restored database catalog verification passed.');
