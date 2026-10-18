// LLM provider layer for agents. Every provider takes the same request
//   { model, messages: [{ role, content, toolCalls?, toolCallId?, name? }], tools: [{ name, description, parameters }],
//     temperature, maxTokens }
// and returns { content, toolCalls: [{ id, name, arguments }], usage: { promptTokens, completionTokens }, model }.
// Keys come from an encrypted 'ai_provider' connection or from AI_* environment variables and are
// never logged or returned by the API.
import { decryptJson } from '../lib/cryptoSecrets.js';
import { AppError } from '../lib/errors.js';

export const PROVIDERS = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  azure_openai: { label: 'Azure OpenAI', baseUrl: '', needsKey: true },
  anthropic: { label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', needsKey: true },
  openai_compatible: { label: 'OpenAI-compatible', baseUrl: '', needsKey: false },
  mock: { label: 'Mock (tests)', baseUrl: '', needsKey: false },
};

const trimSlash = (value) => String(value || '').replace(/\/+$/, '');

/**
 * Resolves the provider settings for an agent: the agent's chosen 'ai_provider' connection, else
 * the first available one in the project, else the AI_* environment default. Returns null when
 * nothing usable is configured.
 */
export async function resolveProvider(pool, cfg, { projectId, connectionId = null, model = '' }) {
  let settings = null;
  if (connectionId || projectId) {
    const [rows] = await pool.query(
      connectionId
        ? `SELECT * FROM connections WHERE id = ? AND project_id = ? AND connector_type = 'ai_provider'`
        : `SELECT * FROM connections WHERE project_id = ? AND connector_type = 'ai_provider' AND status <> 'unavailable' ORDER BY created_at LIMIT 1`,
      connectionId ? [connectionId, projectId] : [projectId],
    );
    const row = rows[0];
    if (connectionId && !row) throw new AppError(400, 'AI_CONNECTION_NOT_FOUND', 'The AI provider connection is not in this project');
    if (row) {
      const config = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json || {};
      const secret = row.secret_ciphertext ? decryptJson(row.secret_ciphertext, row.secret_iv, row.secret_tag, cfg.credentialsKey) : {};
      settings = {
        source: 'connection', connectionId: row.id, connectionName: row.name,
        provider: config.provider, baseUrl: config.baseUrl, model: config.model, apiVersion: config.apiVersion, apiKey: secret.apiKey || secret.token || '',
      };
    }
  }
  if (!settings && cfg.ai?.provider) {
    settings = { source: 'env', provider: cfg.ai.provider, baseUrl: cfg.ai.baseUrl, model: cfg.ai.model, apiVersion: cfg.ai.apiVersion, apiKey: cfg.ai.apiKey };
  }
  if (!settings) return null;
  if (!PROVIDERS[settings.provider]) return null;
  if (settings.provider === 'mock' && !cfg.ai?.allowMock) return null;
  const meta = PROVIDERS[settings.provider];
  if (meta.needsKey && !settings.apiKey) return null;
  if (['azure_openai', 'openai_compatible'].includes(settings.provider) && !settings.baseUrl) return null;
  settings.model = model || settings.model || (settings.provider === 'mock' ? 'mock-1' : '');
  if (!settings.model) return null;
  settings.timeoutMs = cfg.ai?.requestTimeoutMs || 60000;
  settings.label = `${meta.label} · ${settings.model}`;
  return settings;
}

/** Public description of a provider setting, without the key. */
export function describeProvider(settings) {
  if (!settings) return null;
  return {
    source: settings.source, provider: settings.provider, providerLabel: PROVIDERS[settings.provider]?.label || settings.provider,
    model: settings.model, connectionId: settings.connectionId || null, connectionName: settings.connectionName || null,
  };
}

export async function chat(settings, request) {
  if (settings.provider === 'mock') return mockChat(request);
  if (settings.provider === 'anthropic') return anthropicChat(settings, request);
  return openAiChat(settings, request);
}

async function postJson(url, headers, body, timeoutMs) {
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new AppError(504, 'AI_TIMEOUT', `The AI provider did not answer within ${Math.round(timeoutMs / 1000)}s`);
    throw new AppError(502, 'AI_UNREACHABLE', `Could not reach the AI provider: ${error.cause?.code || error.message}`);
  }
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || text.slice(0, 200);
    throw new AppError(502, 'AI_PROVIDER_ERROR', `AI provider returned HTTP ${response.status}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`);
  }
  if (!data) throw new AppError(502, 'AI_PROVIDER_ERROR', 'AI provider returned a response that is not JSON');
  return data;
}

function openAiUrl(settings) {
  if (settings.provider === 'azure_openai') {
    const version = settings.apiVersion || '2024-06-01';
    return `${trimSlash(settings.baseUrl)}/openai/deployments/${encodeURIComponent(settings.model)}/chat/completions?api-version=${encodeURIComponent(version)}`;
  }
  return `${trimSlash(settings.baseUrl || PROVIDERS.openai.baseUrl)}/chat/completions`;
}

function toOpenAiMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant', content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) } })),
      };
    }
    if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content ?? '' };
    return { role: message.role, content: message.content ?? '' };
  });
}

function parseArguments(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return { _invalid: String(raw).slice(0, 500) }; }
}

async function openAiChat(settings, request) {
  const headers = settings.provider === 'azure_openai'
    ? { 'api-key': settings.apiKey }
    : (settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {});
  const body = {
    model: settings.model,
    messages: toOpenAiMessages(request.messages),
    temperature: request.temperature,
    max_tokens: request.maxTokens,
  };
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
    body.tool_choice = 'auto';
  }
  const data = await postJson(openAiUrl(settings), headers, body, settings.timeoutMs);
  const message = data.choices?.[0]?.message || {};
  return {
    content: typeof message.content === 'string' ? message.content : '',
    toolCalls: (message.tool_calls || []).map((call, index) => ({ id: call.id || `call_${index}`, name: call.function?.name, arguments: parseArguments(call.function?.arguments) })),
    usage: { promptTokens: data.usage?.prompt_tokens || 0, completionTokens: data.usage?.completion_tokens || 0 },
    model: data.model || settings.model,
  };
}

async function anthropicChat(settings, request) {
  const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const messages = [];
  const push = (role, block) => {
    const last = messages.at(-1);
    if (last && last.role === role) last.content.push(block);
    else messages.push({ role, content: [block] });
  };
  for (const message of request.messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') { push('user', { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content ?? '' }); continue; }
    if (message.role === 'assistant') {
      if (message.content) push('assistant', { type: 'text', text: message.content });
      for (const call of message.toolCalls || []) push('assistant', { type: 'tool_use', id: call.id, name: call.name, input: call.arguments ?? {} });
      continue;
    }
    push('user', { type: 'text', text: message.content ?? '' });
  }
  const body = { model: settings.model, system: system || undefined, messages, max_tokens: request.maxTokens, temperature: request.temperature };
  if (request.tools?.length) body.tools = request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
  const data = await postJson(`${trimSlash(settings.baseUrl || PROVIDERS.anthropic.baseUrl)}/messages`, { 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' }, body, settings.timeoutMs);
  const blocks = data.content || [];
  return {
    content: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
    toolCalls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, arguments: b.input || {} })),
    usage: { promptTokens: data.usage?.input_tokens || 0, completionTokens: data.usage?.output_tokens || 0 },
    model: data.model || settings.model,
  };
}

/** Cheap reachability check used by "Test connection". */
export async function pingProvider(settings) {
  const result = await chat({ ...settings, timeoutMs: Math.min(settings.timeoutMs || 20000, 20000) }, {
    messages: [{ role: 'user', content: 'Reply with the single word OK.' }], tools: [], temperature: 0, maxTokens: 16,
  });
  return { model: result.model };
}

// ---------------------------------------------------------------------------------------------
// Deterministic mock provider (tests and local demos only). Directives in the latest user message:
//   #call <tool> {json}   call that tool with those arguments (several #call lines = several calls)
//   #loop                 keep calling the first tool forever (exercises the max-steps guard)
//   #fail                 throw a provider error
// Without directives it calls each tool named in the message once ("use lookup_jobs"), then answers.
// When a submit_output tool exists it finishes through it with { summary } plus required fields.
// ---------------------------------------------------------------------------------------------
const estimate = (text) => Math.max(1, Math.ceil(String(text || '').length / 4));

export function mockChat(request) {
  const { messages, tools = [] } = request;
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user');
  const user = readable(messages[lastUserIndex]?.content || '');
  const after = messages.slice(lastUserIndex + 1);
  const toolResults = after.filter((m) => m.role === 'tool');
  const promptTokens = messages.reduce((sum, m) => sum + estimate(m.content) + estimate(JSON.stringify(m.toolCalls || '')), 0);
  const reply = (content, toolCalls = []) => ({
    content, toolCalls, model: 'mock-1',
    usage: { promptTokens, completionTokens: estimate(content) + estimate(JSON.stringify(toolCalls)) },
  });
  const callId = () => `call_${after.length}_${Math.abs(hash(user + after.length)).toString(36)}`;
  if (/#fail\b/.test(user)) throw new AppError(502, 'AI_PROVIDER_ERROR', 'Mock provider failure (#fail)');
  const callable = tools.filter((tool) => tool.name !== 'submit_output');
  if (/#loop\b/.test(user) && callable[0]) return reply('', [{ id: callId(), name: callable[0].name, arguments: defaultArguments(callable[0]) }]);
  const directives = [...user.matchAll(/#call\s+([a-z][a-z0-9_]*)\s*(\{[^\n]*\})?/g)].map((match) => ({ name: match[1], arguments: safeParse(match[2]) }));
  const wanted = directives.length ? directives : callable.filter((tool) => user.includes(tool.name)).map((tool) => ({ name: tool.name, arguments: defaultArguments(tool) }));
  if (!toolResults.length && wanted.length && after.every((m) => !m.toolCalls?.length)) {
    return reply('', wanted.map((call, index) => ({ id: `${callId()}_${index}`, name: call.name, arguments: call.arguments })));
  }
  const summary = toolResults.length
    ? `Done. ${toolResults.map((m) => `${m.name || 'tool'} returned ${String(m.content).length > 100 ? `${String(m.content).slice(0, 100)}…` : String(m.content)}`).join('; ')}`
    : `You said: ${String(user).replace(/#\w+/g, '').trim().slice(0, 300) || '(nothing)'}`;
  const submit = tools.find((tool) => tool.name === 'submit_output');
  if (submit && !after.some((m) => m.toolCalls?.some((call) => call.name === 'submit_output'))) {
    const args = { summary };
    for (const [name, schema] of Object.entries(submit.parameters?.properties || {})) {
      if (name in args) continue;
      args[name] = schema.type === 'number' ? 1 : schema.type === 'boolean' ? true : schema.type === 'object' ? {} : `mock ${name}`;
    }
    return reply('', [{ id: callId(), name: 'submit_output', arguments: args }]);
  }
  return reply(summary);
}

// Task input arrives as a JSON block; read its string values so directives inside them work.
function readable(text) {
  const block = String(text).match(/```json\n([\s\S]*?)\n```/);
  if (!block) return String(text);
  try {
    const values = Object.values(JSON.parse(block[1]) || {}).filter((value) => typeof value === 'string');
    return values.length ? values.join('\n') : String(text);
  } catch {
    return String(text);
  }
}

function defaultArguments(tool) {
  const args = {};
  const properties = tool.parameters?.properties || {};
  for (const name of tool.parameters?.required || []) {
    const schema = properties[name] || {};
    args[name] = schema.enum ? schema.enum[0] : schema.type === 'number' ? 1 : schema.type === 'boolean' ? true : schema.type === 'object' ? {} : `mock ${name}`;
  }
  return args;
}

function safeParse(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function hash(text) {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) value = (value * 31 + text.charCodeAt(i)) | 0;
  return value;
}
