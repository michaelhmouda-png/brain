import { spawnSync } from 'node:child_process';
import path from 'node:path';

const operation = process.argv[2];
const runnerTemp = process.env.RUNNER_TEMP;
if (!runnerTemp) throw new Error('BACKUP_TEMPORARY_DIRECTORY_MISSING');
const dumpPath = path.join(path.resolve(runnerTemp), 'brain-restore-check.dump');

function postgresEnvironment(raw) {
  let value;
  try { value = new URL(raw); } catch { throw new Error('BACKUP_DATABASE_URL_INVALID'); }
  if (!['postgres:','postgresql:'].includes(value.protocol) || !value.hostname || !value.username || !value.password) throw new Error('BACKUP_DATABASE_URL_INVALID');
  return {
    ...process.env,
    PGHOST: value.hostname,
    PGPORT: value.port || '5432',
    PGUSER: decodeURIComponent(value.username),
    PGPASSWORD: decodeURIComponent(value.password),
    PGDATABASE: decodeURIComponent(value.pathname.replace(/^\//,'')),
    PGSSLMODE: value.searchParams.get('sslmode') ?? 'require',
  };
}

let program; let args; let environment;
if (operation === 'dump') {
  program = 'pg_dump';
  args = ['--format=custom','--no-owner','--no-acl',`--file=${dumpPath}`];
  environment = postgresEnvironment(process.env.BACKUP_SOURCE_DATABASE_URL);
} else if (operation === 'restore') {
  program = 'pg_restore';
  args = ['--clean','--if-exists','--no-owner','--no-acl','--exit-on-error',dumpPath];
  environment = postgresEnvironment(process.env.RESTORE_TARGET_DATABASE_URL);
} else {
  throw new Error('BACKUP_OPERATION_INVALID');
}
const result = spawnSync(program, args, { env: environment, encoding:'utf8', shell:false, windowsHide:true });
if (result.status !== 0) throw new Error(operation === 'dump' ? 'BACKUP_DUMP_FAILED' : 'BACKUP_RESTORE_FAILED');
console.log(operation === 'dump' ? 'Ephemeral backup created.' : 'Disposable restore completed.');
