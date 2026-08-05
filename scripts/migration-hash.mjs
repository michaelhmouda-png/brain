import { createHash } from 'node:crypto';

export function normalizeMigrationContent(content) {
  const text = typeof content === 'string' ? content : Buffer.from(content).toString('utf8');
  return text.replace(/\r\n?/g, '\n');
}

export function migrationSha256(content) {
  return createHash('sha256').update(normalizeMigrationContent(content), 'utf8').digest('hex');
}
