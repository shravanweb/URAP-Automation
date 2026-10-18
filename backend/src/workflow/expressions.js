const FULL = /^\{\{\s*([A-Za-z0-9_.]+)\s*\}\}$/;
const PART = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

export function getPath(source, path) {
  const parts = path.split('.');
  let current = source;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

export function resolveTemplates(value, context) {
  if (typeof value === 'string') {
    const full = value.match(FULL);
    if (full) return getPath(context, full[1]);
    return value.replace(PART, (_, path) => {
      const resolved = getPath(context, path);
      if (resolved == null) return '';
      return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((item) => resolveTemplates(item, context));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = resolveTemplates(child, context);
    }
    return output;
  }
  return value;
}

function same(left, right) {
  if (typeof left === 'number' || typeof right === 'number') {
    if (left === '' || right === '' || left == null || right == null) return left === right;
    const a = Number(left);
    const b = Number(right);
    if (!Number.isNaN(a) && !Number.isNaN(b)) return a === b;
  }
  return left === right;
}

export function compareValues(left, operator, right) {
  switch (operator) {
    case 'eq': return same(left, right);
    case 'neq': return !same(left, right);
    case 'gt': return Number(left) > Number(right);
    case 'gte': return Number(left) >= Number(right);
    case 'lt': return Number(left) < Number(right);
    case 'lte': return Number(left) <= Number(right);
    case 'contains': return String(left ?? '').includes(String(right ?? ''));
    case 'empty':
      return left == null || left === '' || (Array.isArray(left) && left.length === 0);
    case 'not_empty':
      return !compareValues(left, 'empty');
    default:
      return false;
  }
}
