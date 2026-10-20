// Copy of backend/src/agent/config.js (agent defaults, validation, tool schemas).
// Keep the two files in sync.
// Agent configuration: defaults, validation, and the tool (function) schemas sent to the model.
// Pure module, shared with the frontend (frontend/src/lib/agentConfig.js is a copy; keep in sync).

export const AGENT_TYPES = ['conversational', 'autonomous', 'coded'];
export const TOOL_TYPES = ['workflow', 'task', 'case', 'http', 'query', 'code'];
export const FIELD_TYPES = ['string', 'number', 'boolean', 'object'];
export const QUERY_RESOURCES = ['jobs', 'queue_items', 'tasks', 'workflows'];
export const TASK_ROLES = ['administrator', 'project_manager', 'automation_developer', 'operator'];
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const LIMITS = {
  maxSteps: [1, 25], maxTokens: [64, 8192], maxTotalTokens: [1000, 500000], temperature: [0, 2], toolTimeoutMinutes: [1, 10080],
};
const NAME = /^[a-z][a-z0-9_]{1,47}$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export function defaultAgentConfig(type = 'conversational') {
  if (type === 'coded') {
    return {
      instructions: 'Describe what this script does for the people who maintain it.',
      connectionId: null,
      model: '',
      temperature: 0.2,
      maxSteps: 1,
      maxTokens: 1024,
      maxTotalTokens: 50000,
      toolTimeoutMinutes: 1,
      greeting: '',
      source: "return { summary: String(input.request || '') };",
      tools: [],
      inputSchema: [{ name: 'request', type: 'string', description: 'What the script should handle', required: true }],
      outputSchema: [{ name: 'summary', type: 'string', description: 'Short result', required: true }],
    };
  }
  return {
    instructions: type === 'autonomous'
      ? 'You are an operations agent. Use the tools to complete the task described in the input, then submit the output.'
      : 'You are a helpful operations assistant for this project. Answer clearly and use the tools when they help.',
    connectionId: null,
    model: '',
    temperature: 0.2,
    maxSteps: 8,
    maxTokens: 1024,
    maxTotalTokens: 50000,
    toolTimeoutMinutes: 60,
    greeting: type === 'conversational' ? 'Hi! How can I help?' : '',
    tools: [],
    inputSchema: type === 'autonomous' ? [{ name: 'request', type: 'string', description: 'What the agent should do', required: true }] : [],
    outputSchema: type === 'autonomous' ? [{ name: 'summary', type: 'string', description: 'Short result summary', required: true }] : [],
  };
}

export function newTool(type, existing = []) {
  const base = { workflow: 'run_workflow', task: 'ask_a_person', case: 'open_case', http: 'call_api', query: 'look_up_project_data', code: 'run_script' }[type] || 'tool';
  const names = new Set(existing.map((tool) => tool.name));
  let name = base;
  for (let n = 2; names.has(name); n += 1) name = `${base}_${n}`;
  const ids = new Set(existing.map((tool) => tool.id));
  let index = existing.length + 1;
  while (ids.has(`t${index}`)) index += 1;
  const common = { id: `t${index}`, type, name };
  switch (type) {
    case 'workflow': return { ...common, description: 'Runs a published workflow and returns its output.', workflowId: '', inputs: [] };
    case 'task': return { ...common, description: 'Asks a person in Action Center to review or decide, and waits for the answer.', assignedRole: '', assigneeUserId: '', priority: 'medium', wait: true };
    case 'case': return { ...common, description: 'Opens a case of a published case type with the given fields and returns its reference.', caseTypeId: '' };
    case 'http': return { ...common, description: 'Calls the project REST API connection.', connectionId: '', method: 'GET', pathPrefix: '/' };
    case 'query': return { ...common, description: 'Looks up recent jobs, queue items, tasks, or workflows in this project.', resources: ['jobs', 'tasks'] };
    case 'code': return { ...common, description: 'Runs a sandboxed JavaScript function and returns JSON.', source: 'return { ok: true, echo: args };', inputs: [] };
    default: return common;
  }
}

function fieldProperties(fields = []) {
  const properties = {};
  const required = [];
  for (const field of fields) {
    properties[field.name] = { type: FIELD_TYPES.includes(field.type) ? field.type : 'string', ...(field.description ? { description: field.description } : {}) };
    if (field.required) required.push(field.name);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

/** Function definitions for the model (name, description, JSON-schema parameters). */
export function buildToolSchemas(config, agentType = 'conversational') {
  const schemas = (config.tools || []).map((tool) => {
    switch (tool.type) {
      case 'workflow':
        return { name: tool.name, description: tool.description || 'Run a workflow', parameters: fieldProperties(tool.inputs) };
      case 'task':
        return {
          name: tool.name,
          description: `${tool.description || 'Ask a person'}${tool.wait === false ? ' Does not wait for the answer.' : ' Waits for the decision (approve or reject) and comment.'}`,
          parameters: { type: 'object', properties: { title: { type: 'string', description: 'Short task title shown to the person' }, details: { type: 'string', description: 'What the person should check or decide' }, data: { type: 'object', description: 'Key facts to show the person' } }, required: ['title'] },
        };
      case 'case':
        return {
          name: tool.name,
          description: tool.description || 'Open a case',
          parameters: { type: 'object', properties: { title: { type: 'string', description: 'Short case title' }, priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, fields: { type: 'object', description: 'Case field values by field name' } }, required: ['title'] },
        };
      case 'http':
        return {
          name: tool.name,
          description: `${tool.description || 'Call an API'} Method ${tool.method || 'GET'}; path must start with ${tool.pathPrefix || '/'}.`,
          parameters: { type: 'object', properties: { path: { type: 'string', description: `Relative path starting with ${tool.pathPrefix || '/'}` }, query: { type: 'object', description: 'Query string parameters' }, ...(['POST', 'PUT', 'PATCH'].includes(tool.method) ? { body: { type: 'object', description: 'JSON body' } } : {}) }, required: ['path'] },
        };
      case 'query':
        return {
          name: tool.name,
          description: tool.description || 'Look up project data',
          parameters: { type: 'object', properties: { resource: { type: 'string', enum: tool.resources?.length ? tool.resources : QUERY_RESOURCES }, status: { type: 'string', description: 'Optional status filter' }, limit: { type: 'number', description: 'How many rows (max 25)' } }, required: ['resource'] },
        };
      case 'code':
        return { name: tool.name, description: `${tool.description || 'Run a script'} The function receives args and returns JSON. It cannot read files or use the network.`, parameters: fieldProperties(tool.inputs) };
      default:
        return null;
    }
  }).filter(Boolean);
  if (agentType === 'autonomous' && config.outputSchema?.length) {
    schemas.push({ name: 'submit_output', description: 'Finish the task and return the final output. Call this exactly once when done.', parameters: fieldProperties(config.outputSchema) });
  }
  return schemas;
}

const inRange = (value, [min, max]) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

function validateFields(fields, key, label, errors) {
  if (!Array.isArray(fields)) { errors.push({ field: key, message: `${label} must be a list` }); return; }
  const seen = new Set();
  for (const field of fields) {
    if (!FIELD.test(field?.name || '')) errors.push({ field: key, message: `${label}: “${field?.name || ''}” is not a valid field name (letters, digits, underscore)` });
    else if (seen.has(field.name)) errors.push({ field: key, message: `${label}: “${field.name}” is listed twice` });
    seen.add(field?.name);
    if (!FIELD_TYPES.includes(field?.type)) errors.push({ field: key, message: `${label}: “${field?.name}” needs a type (${FIELD_TYPES.join(', ')})` });
  }
}

/**
 * Validates an agent configuration. lookups (optional): { workflows: Map(id -> {status, current_version_id, name}),
 * connections: Map(id -> {connector_type}), users: Set(id) }.
 */
export function validateAgentConfig(config, lookups = null, agentType = 'conversational') {
  const errors = [];
  const warnings = [];
  if (!config || typeof config !== 'object') return { errors: [{ field: 'config', message: 'Configuration is missing' }], warnings };
  if (!String(config.instructions || '').trim()) errors.push({ field: 'instructions', message: 'Write instructions that tell the agent what to do' });
  else if (String(config.instructions).length > 20000) errors.push({ field: 'instructions', message: 'Instructions are limited to 20,000 characters' });
  if (config.model && !/^[\w.:/@-]{1,120}$/.test(config.model)) errors.push({ field: 'model', message: 'Model name has invalid characters' });
  if (!inRange(config.temperature, LIMITS.temperature)) errors.push({ field: 'temperature', message: 'Temperature must be between 0 and 2' });
  if (!Number.isInteger(config.maxSteps) || !inRange(config.maxSteps, LIMITS.maxSteps)) errors.push({ field: 'maxSteps', message: 'Max steps must be a whole number from 1 to 25' });
  if (!Number.isInteger(config.maxTokens) || !inRange(config.maxTokens, LIMITS.maxTokens)) errors.push({ field: 'maxTokens', message: 'Max tokens per reply must be from 64 to 8192' });
  if (!Number.isInteger(config.maxTotalTokens) || !inRange(config.maxTotalTokens, LIMITS.maxTotalTokens)) errors.push({ field: 'maxTotalTokens', message: 'Token budget per run must be from 1,000 to 500,000' });
  if (!Number.isInteger(config.toolTimeoutMinutes) || !inRange(config.toolTimeoutMinutes, LIMITS.toolTimeoutMinutes)) errors.push({ field: 'toolTimeoutMinutes', message: 'Tool wait limit must be from 1 minute to 7 days' });
  if (config.connectionId && lookups) {
    const connection = lookups.connections.get(config.connectionId);
    if (!connection || connection.connector_type !== 'ai_provider') errors.push({ field: 'connectionId', message: 'Pick an AI provider connection from this project' });
  }
  const tools = Array.isArray(config.tools) ? config.tools : [];
  if (tools.length > 20) errors.push({ field: 'tools', message: 'An agent can have at most 20 tools' });
  const names = new Set();
  for (const tool of tools) {
    const where = { field: `tools.${tool.id}`, toolId: tool.id };
    const label = tool.name || tool.type;
    if (!TOOL_TYPES.includes(tool.type)) { errors.push({ ...where, message: `${label}: unknown tool type` }); continue; }
    if (!NAME.test(tool.name || '')) errors.push({ ...where, message: `${label}: name must be lowercase letters, digits, or underscores (2–48), starting with a letter` });
    else if (tool.name === 'submit_output') errors.push({ ...where, message: 'submit_output is reserved' });
    else if (names.has(tool.name)) errors.push({ ...where, message: `Two tools are named ${tool.name}` });
    names.add(tool.name);
    if (!String(tool.description || '').trim()) warnings.push({ ...where, message: `${label}: a description helps the model decide when to use it` });
    if (tool.type === 'workflow') {
      if (!tool.workflowId) errors.push({ ...where, message: `${label}: pick a workflow` });
      else if (lookups) {
        const workflow = lookups.workflows.get(tool.workflowId);
        if (!workflow) errors.push({ ...where, message: `${label}: the workflow is not in this project` });
        else if (workflow.status !== 'published' || !workflow.current_version_id) errors.push({ ...where, message: `${label}: ${workflow.name} is not published` });
      }
      validateFields(tool.inputs || [], where.field, `${label} inputs`, errors);
    }
    if (tool.type === 'task') {
      if (tool.assignedRole && !TASK_ROLES.includes(tool.assignedRole)) errors.push({ ...where, message: `${label}: unknown role` });
      if (tool.assigneeUserId && lookups && !lookups.users.has(tool.assigneeUserId)) errors.push({ ...where, message: `${label}: the assignee is not an active user` });
    }
    if (tool.type === 'case') {
      if (!tool.caseTypeId) errors.push({ ...where, message: `${label}: pick a case type` });
      else if (lookups?.caseTypes) {
        const caseType = lookups.caseTypes.get(tool.caseTypeId);
        if (!caseType) errors.push({ ...where, message: `${label}: the case type is not in this project` });
        else if (caseType.status !== 'published') errors.push({ ...where, message: `${label}: ${caseType.name} is not published` });
      }
    }
    if (tool.type === 'http') {
      if (!tool.connectionId) errors.push({ ...where, message: `${label}: pick a REST API connection` });
      else if (lookups) {
        const connection = lookups.connections.get(tool.connectionId);
        if (!connection || connection.connector_type !== 'rest_api') errors.push({ ...where, message: `${label}: pick a REST API connection from this project` });
      }
      if (!HTTP_METHODS.includes(tool.method)) errors.push({ ...where, message: `${label}: pick an HTTP method` });
      if (!String(tool.pathPrefix || '/').startsWith('/')) errors.push({ ...where, message: `${label}: path prefix must start with /` });
    }
    if (tool.type === 'query') {
      if (!Array.isArray(tool.resources) || !tool.resources.length || tool.resources.some((item) => !QUERY_RESOURCES.includes(item))) errors.push({ ...where, message: `${label}: pick what it may look up` });
    }
    if (tool.type === 'code') {
      if (!String(tool.source || '').trim()) errors.push({ ...where, message: `${label}: write the script` });
      else if (String(tool.source).length > 8000) errors.push({ ...where, message: `${label}: scripts are limited to 8,000 characters` });
      validateFields(tool.inputs || [], where.field, `${label} inputs`, errors);
    } else if (agentType === 'coded') {
      errors.push({ ...where, message: `${label}: coded agents can only use JavaScript tools` });
    }
  }
  if (agentType === 'coded') {
    if (!String(config.source || '').trim()) errors.push({ field: 'source', message: 'Write the script that runs when this agent starts' });
    else if (String(config.source).length > 8000) errors.push({ field: 'source', message: 'Scripts are limited to 8,000 characters' });
  }
  validateFields(config.inputSchema || [], 'inputSchema', 'Input', errors);
  validateFields(config.outputSchema || [], 'outputSchema', 'Output', errors);
  if (agentType === 'autonomous' && !(config.outputSchema || []).length) warnings.push({ field: 'outputSchema', message: 'Without output fields the final answer is returned as text' });
  return { errors, warnings };
}
