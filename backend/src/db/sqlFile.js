import fs from 'node:fs/promises';

export async function readStatements(file) {
  const raw = await fs.readFile(file, 'utf8');
  const withoutComments = raw
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}
