// Records a browser session on this machine and prints workflow steps.
//
// Usage:  npm run record -- https://example.com [--out recorded.json] [--headless]
// Click, type, and select in the browser window that opens; close the window (or press Ctrl+C)
// to finish. The output is a complete workflow definition you can import in the designer
// (Designer > Import JSON) or paste into a workflow version.
import fs from 'node:fs/promises';
import { automationConfig } from './config.js';
import { createRecorder, stepsToDefinition } from './automation/web/recorder.js';

const args = process.argv.slice(2);
const url = args.find((arg) => /^https?:\/\//i.test(arg));
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : '';
if (!url) {
  console.error('Usage: npm run record -- <http(s) url> [--out file.json] [--headless]');
  process.exit(2);
}
const recorder = createRecorder({ cfg: automationConfig() });
const session = await recorder.start({ url, headless: args.includes('--headless'), ownerId: 'cli' });
console.error(`Recording ${url}. Use the browser, then close it or press Ctrl+C to finish.`);

let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  const result = await recorder.stop(session.id, 'cli');
  await recorder.closeAll();
  const definition = stepsToDefinition(result.steps);
  const text = JSON.stringify(definition, null, 2);
  if (out) {
    await fs.writeFile(out, text);
    console.error(`Wrote ${definition.steps.length} steps to ${out}`);
  } else {
    console.log(text);
  }
  process.exit(0);
}
process.on('SIGINT', finish);
process.on('SIGTERM', finish);
const timer = setInterval(() => {
  const state = recorder.get(session.id, 'cli');
  if (state.status !== 'recording') {
    clearInterval(timer);
    finish();
  }
}, 500);
