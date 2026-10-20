// Required run input = every top-level {{input.<name>}} the workflow's steps reference. Manual runs
// must supply a non-empty value for each, so nothing runs on made-up defaults.
const REF = /\{\{\s*input\.([A-Za-z_$][\w$]*)/g;

export function inputRefs(definition) {
  const steps = (typeof definition === 'string' ? JSON.parse(definition) : definition)?.steps || [];
  return [...new Set([...JSON.stringify(steps).matchAll(REF)].map((match) => match[1]))];
}

export function missingInput(definition, input = {}) {
  return inputRefs(definition).filter((name) => {
    const value = input?.[name];
    return value == null || (typeof value === 'string' && !value.trim());
  });
}
