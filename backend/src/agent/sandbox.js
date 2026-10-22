// Runs user JavaScript for coded agents and code tools.
// The script runs in a child process with Node's permission model: no filesystem, network,
// child processes, workers, or native addons, and no access to this process's environment.
// `node:vm` is not used; it is not a security boundary.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../lib/errors.js';

const MAX_SOURCE = 8000;
const MAX_RESULT = 100000;

const WRAPPER = `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const tools = {};
for (const [name, source] of Object.entries(payload.tools || {})) {
  if (!/^[a-z][a-z0-9_]{1,47}$/.test(name)) continue;
  tools[name] = new AsyncFunction('args', '"use strict";\\n' + String(source));
}
const main = new AsyncFunction('input', 'tools', '"use strict";\\n' + String(payload.source || ''));
try {
  const result = await main(payload.input ?? {}, tools);
  const text = JSON.stringify(result === undefined ? null : result);
  if (text.length > ${MAX_RESULT}) throw new Error('The script result is larger than 100 KB');
  process.stdout.write(text);
} catch (error) {
  process.stderr.write(String(error && error.message ? error.message : error).slice(0, 1000));
  process.exit(1);
}
`;

/**
 * Runs `source` as the body of an async function (input, tools).
 * Tool sources are async functions of (args). Returns the JSON value the script returns.
 */
export async function runUserCode({ source, input = {}, tools = {}, timeoutMs = 8000 } = {}) {
  if (typeof source !== 'string' || !source.trim()) throw new AppError(400, 'CODE_EMPTY', 'The script is empty');
  if (source.length > MAX_SOURCE) throw new AppError(400, 'CODE_TOO_LARGE', 'Scripts are limited to 8,000 characters');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'urap-code-'));
  const script = path.join(dir, 'run.mjs');
  await fs.writeFile(script, WRAPPER, 'utf8');
  const child = spawn(process.execPath, ['--permission', '--max-old-space-size=64', script], {
    cwd: dir,
    env: { PATH: process.env.PATH || '' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new AppError(504, 'CODE_TIMEOUT', 'The script timed out'));
    }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new AppError(400, 'CODE_FAILED', (stderr.trim() || `The script exited with code ${code}`).slice(0, 1000)));
    });
  });
  child.stdin.end(JSON.stringify({ source, input, tools }));
  try {
    const text = await finished;
    return JSON.parse(text);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
