// Run input is never pre-filled with sample values. The fields a run needs are the top-level
// {{input.<name>}} references in the workflow's steps; each is required and the person starting
// the run types the real value. backend/src/workflow/inputRefs.js applies the same rule server-side.

const REF = /\{\{\s*input\.([A-Za-z_$][\w$]*)/g;

export function inputRefs(steps = []) {
  const names = new Set();
  const text = JSON.stringify(steps || []);
  for (const match of text.matchAll(REF)) names.add(match[1]);
  return [...names];
}

export function labelFor(name) {
  const spaced = name.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Field list for a run dialog. `known` lets a template give a label, type or hint. */
export function inputFields(steps, known = []) {
  const byName = new Map(known.map((field) => [field.name, field]));
  return inputRefs(steps).map((name) => ({ name, label: labelFor(name), type: name === 'rows' ? 'json' : 'text', required: true, ...byName.get(name) }));
}

function coerce(raw, type) {
  const text = String(raw ?? '').trim();
  if (type === 'number' || /^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if ((type === 'json' || /^[[{]/.test(text))) { try { return JSON.parse(text); } catch { return text; } }
  if (text === 'true' || text === 'false') return text === 'true';
  return text;
}

/** Returns { input } or { error } with a message naming every empty required field. */
export function buildRunInput(fields, values) {
  const missing = fields.filter((field) => field.required !== false && !String(values[field.name] ?? '').trim()).map((field) => field.label);
  if (missing.length) return { error: `Enter a value for ${missing.join(', ')} before running.` };
  const bad = fields.filter((field) => field.type === 'number' && !Number.isFinite(Number(String(values[field.name]).trim()))).map((field) => field.label);
  if (bad.length) return { error: `${bad.join(', ')} must be a number.` };
  const input = {};
  for (const field of fields) if (String(values[field.name] ?? '').trim()) input[field.name] = coerce(values[field.name], field.type);
  return { input };
}

export function publishedSteps(workflow) {
  const versions = workflow?.versions || [];
  const version = versions.find((item) => item.id === workflow?.current_version_id) || versions.find((item) => item.status === 'published') || versions[0];
  const definition = typeof version?.definition_json === 'string' ? JSON.parse(version.definition_json) : version?.definition_json;
  return definition?.steps || [];
}
