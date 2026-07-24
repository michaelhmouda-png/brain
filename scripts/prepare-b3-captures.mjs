import fs from 'node:fs';
import path from 'node:path';

const workspace = process.cwd();
const outputDirectory = path.join(workspace, 'b3-validation');

const b0Source = fs.readFileSync(
  path.join(workspace, 'B0_PRODUCTION_CATALOG_CAPTURE.sql'),
  'utf8',
);
const b1Source = fs.readFileSync(
  path.join(workspace, 'B1_PRODUCTION_FUNCTION_AND_ENVIRONMENT_CAPTURE.sql'),
  'utf8',
);

const b0CronBlock = `    'cron_jobs', coalesce((
      SELECT jsonb_agg(
        (
          to_jsonb(job)
          - ARRAY[
              'command',
              'nodename',
              'nodeport',
              'database',
              'username'
            ]
          || jsonb_build_object(
            'command_redacted',
            regexp_replace(
              job.command,
              $cron_literal$'[^']*'$cron_literal$,
              '''[REDACTED_LITERAL]''',
              'g'
            )
          )
        )
        ORDER BY job.jobid
      )
      FROM cron.job AS job
    ), '[]'::jsonb),`;

const b1CronStart = b1Source.indexOf('captured_cron_jobs AS (');
const b1CronEndMarker = '\nproject_reference AS (';
const b1CronEnd = b1Source.indexOf(b1CronEndMarker, b1CronStart);

if (!b0Source.includes(b0CronBlock)) {
  throw new Error('B0_CRON_BLOCK_NOT_FOUND');
}
if (b1CronStart < 0 || b1CronEnd < 0) {
  throw new Error('B1_CRON_BLOCK_NOT_FOUND');
}

const b0Capture = b0Source.replace(
  b0CronBlock,
  `    'cron_jobs', '[]'::jsonb,`,
);

const b1EmptyCronCte = `captured_cron_jobs AS (
  SELECT
    null::bigint AS jobid,
    null::text AS jobname,
    null::text AS schedule,
    null::boolean AS active,
    null::text AS nodename,
    null::integer AS nodeport,
    null::text AS database,
    null::text AS username,
    null::integer AS command_utf8_bytes,
    null::text AS production_command_sha256,
    null::text AS command_redacted,
    null::text AS repository_source_file
  WHERE false
),`;

const b1Capture =
  b1Source.slice(0, b1CronStart) +
  b1EmptyCronCte +
  b1Source.slice(b1CronEnd + 1);

for (const [name, sql] of [
  ['B3_CATALOG_CAPTURE.sql', b0Capture],
  ['B3_FUNCTION_CAPTURE.sql', b1Capture],
]) {
  if (sql.includes('FROM cron.job')) {
    throw new Error(`OPTIONAL_CRON_RELATION_STILL_REFERENCED ${name}`);
  }
  const withoutLeadingComments = sql
    .replace(/^\s*\/\*[\s\S]*?\*\//, '')
    .replace(/^(?:\s*--[^\r\n]*(?:\r?\n|$))+/, '');
  if (!/^WITH\b/i.test(withoutLeadingComments.trimStart())) {
    throw new Error(`EXPECTED_SINGLE_WITH_SELECT_MISSING ${name}`);
  }
  if (!sql.trimEnd().endsWith(';')) {
    throw new Error(`FINAL_SEMICOLON_MISSING ${name}`);
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, name), sql, 'utf8');
}

console.log(
  JSON.stringify(
    {
      status: 'b3_capture_scripts_prepared',
      changes: {
        B3_CATALOG_CAPTURE: 'cron_jobs forced to an empty JSON array',
        B3_FUNCTION_CAPTURE:
          'captured_cron_jobs replaced with an empty typed CTE',
      },
      other_capture_sections_changed: false,
    },
    null,
    2,
  ),
);
