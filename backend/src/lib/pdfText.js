export function extractPdfLiteralText(buffer) {
  const source = buffer.toString('latin1');
  const chunks = [];
  const pattern = /\((?:\\[()\\]|\\n|\\r|\\t|[^\\)])*\)\s*Tj/g;
  for (const match of source.matchAll(pattern)) {
    const raw = match[0];
    const inner = raw.slice(raw.indexOf('(') + 1, raw.lastIndexOf(')'));
    chunks.push(inner
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\'));
  }
  return chunks.join('\n').trim();
}
