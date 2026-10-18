import path from 'node:path';
import { AppError } from './errors.js';

export function resolveInside(root, relativePath) {
  if (relativePath === undefined || relativePath === null || relativePath === '') {
    throw new AppError(400, 'INVALID_PATH', 'A relative file path is required');
  }
  if (typeof relativePath !== 'string' || relativePath.includes('\0')) {
    throw new AppError(400, 'INVALID_PATH', 'Invalid file path');
  }
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, relativePath);
  const rel = path.relative(rootAbs, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new AppError(400, 'INVALID_PATH', 'Path escapes the configured storage root');
  }
  return target;
}
