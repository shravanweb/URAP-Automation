const SECRET_KEY = /password|passwd|secret|token|authorization|api[-_]?key|credential|cookie/i;

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    if (Buffer.isBuffer(value)) return '[binary]';
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(child);
    }
    return output;
  }
  return value;
}

export function clampJson(value, maxChars = 400000) {
  const cleaned = redact(value);
  const text = JSON.stringify(cleaned);
  if (text.length <= maxChars) return cleaned;
  return { truncated: true, preview: text.slice(0, maxChars) };
}
