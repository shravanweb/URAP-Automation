// Windows desktop driver: runs windows/uia-helper.ps1 once per command with the payload as
// base64 JSON and reads one JSON line back. Uses Windows PowerShell 5.1 (powershell.exe) by
// default because it ships with Windows and loads the .NET UI Automation assemblies.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../lib/errors.js';

export const HELPER_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'windows', 'uia-helper.ps1');

export function buildPowershellArgs(command, payload, script = HELPER_SCRIPT) {
  const encoded = Buffer.from(JSON.stringify({ command, ...payload }), 'utf8').toString('base64');
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Payload', encoded];
}

export function parseHelperOutput(stdout, stderr = '', exitCode = 0) {
  const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const last = lines.reverse().find((line) => line.startsWith('{'));
  if (!last) {
    throw new AppError(502, 'DESKTOP_HELPER_FAILED', `Desktop helper returned no result (exit ${exitCode}). ${String(stderr).trim().slice(0, 400)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(last);
  } catch {
    throw new AppError(502, 'DESKTOP_HELPER_FAILED', 'Desktop helper returned invalid JSON');
  }
  if (!parsed.ok) {
    const error = new AppError(parsed.code === 'ELEMENT_NOT_FOUND' || parsed.code === 'WINDOW_NOT_FOUND' ? 504 : 502, parsed.code || 'DESKTOP_ERROR', parsed.message || 'Desktop action failed');
    error.retryable = ['ELEMENT_NOT_FOUND', 'WINDOW_NOT_FOUND'].includes(parsed.code);
    throw error;
  }
  return parsed.result || {};
}

export function createWindowsDriver({ timeoutMs = 60000, powershell = 'powershell.exe', spawnImpl = spawn, script = HELPER_SCRIPT } = {}) {
  return {
    name: 'windows',
    execute(command, payload) {
      return new Promise((resolve, reject) => {
        const child = spawnImpl(powershell, buildPowershellArgs(command, payload, script), { windowsHide: true });
        let stdout = '';
        let stderr = '';
        const limit = Math.max(Number(payload?.timeoutMs) || 0, 0) + (Number(timeoutMs) || 60000);
        const timer = setTimeout(() => {
          child.kill();
          reject(new AppError(504, 'DESKTOP_TIMEOUT', `Desktop command ${command} did not finish in ${limit}ms`));
        }, limit);
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(new AppError(500, 'DESKTOP_HELPER_FAILED', `Could not start ${powershell}: ${error.message}`));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          try {
            resolve(parseHelperOutput(stdout, stderr, code));
          } catch (error) {
            reject(error);
          }
        });
      });
    },
  };
}
