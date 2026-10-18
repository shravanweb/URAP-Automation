// Copy of backend/src/flow/definition.js (pure graph rules) so the editor validates exactly like publish.
// Keep the two files in sync.
// Flow definitions: a directed graph of nodes and edges. Pure functions only (no database), so
// the frontend editor rules and the backend publish checks stay the same.
//
// { nodes: [{ id, type, name, x, y, config }], edges: [{ id, from, to, label, condition, isDefault }],
//   variables: [{ name, defaultValue }] }

export const NODE_TYPES = ['start', 'robot', 'agent', 'human', 'case', 'decision', 'parallel', 'join', 'timer', 'http', 'end'];
export const OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'empty', 'not_empty'];
export const TRIGGERS = ['manual', 'schedule', 'webhook'];
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_TIMER_SECONDS = 30 * 24 * 3600;

export function emptyDefinition() {
  return {
    nodes: [
      { id: 'start', type: 'start', name: 'Start', x: 80, y: 200, config: { trigger: 'manual' } },
      { id: 'end', type: 'end', name: 'End', x: 520, y: 200, config: {} },
    ],
    edges: [{ id: 'e_start_end', from: 'start', to: 'end' }],
    variables: [],
  };
}

/** Starter for the Orchestration > Flow option: call an API, branch on the answer, hand off. */
export function apiOrchestrationDefinition() {
  return {
    nodes: [
      { id: 'start', type: 'start', name: 'Start', x: 60, y: 200, config: { trigger: 'manual' } },
      { id: 'call_api', type: 'http', name: 'Call API', x: 260, y: 200, config: { method: 'GET', path: '/', outputVar: 'api' } },
      { id: 'check', type: 'decision', name: 'Response OK?', x: 470, y: 200, config: {} },
      { id: 'review', type: 'human', name: 'Review response', x: 690, y: 320, config: { title: 'Review the API response', taskType: 'approval', outputVar: 'review' } },
      { id: 'end', type: 'end', name: 'End', x: 910, y: 200, config: {} },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'call_api' },
      { id: 'e2', from: 'call_api', to: 'check' },
      { id: 'e3', from: 'check', to: 'end', label: 'OK', condition: { left: 'vars.api.status', op: 'lt', right: '400' } },
      { id: 'e4', from: 'check', to: 'review', label: 'Otherwise', isDefault: true },
      { id: 'e5', from: 'review', to: 'end' },
    ],
    variables: [],
  };
}

export function outputVarOf(node) {
  const value = node?.config?.outputVar;
  return typeof value === 'string' && value ? value : null;
}

/**
 * Structural validation. Returns { errors, warnings } where each item is { nodeId?, edgeId?, message }.
 * `lookups` (optional, backend publish) adds existence checks: { workflows: Map(id -> row),
 * connections: Map(id -> row), users: Set(ids), agents: Map(id -> row), caseTypes: Map(id -> row) }.
 */
export function validateDefinition(definition, lookups = null) {
  const errors = [];
  const warnings = [];
  const add = (list, message, ref = {}) => list.push({ ...ref, message });
  if (!definition || !Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
    return { errors: [{ message: 'The flow definition needs nodes and edges' }], warnings };
  }
  const { nodes, edges } = definition;
  if (nodes.length > 200) add(errors, 'A flow can have at most 200 steps');
  const byId = new Map();
  for (const node of nodes) {
    if (!node || !ID.test(String(node.id || ''))) { add(errors, 'Every step needs an id of letters, digits, - or _'); continue; }
    if (byId.has(node.id)) add(errors, `Duplicate step id ${node.id}`, { nodeId: node.id });
    if (!NODE_TYPES.includes(node.type)) add(errors, `Unknown step type ${node.type}`, { nodeId: node.id });
    byId.set(node.id, node);
  }
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const edgeIds = new Set();
  for (const edge of edges) {
    if (!edge || !ID.test(String(edge.id || ''))) { add(errors, 'Every connection needs an id'); continue; }
    if (edgeIds.has(edge.id)) add(errors, `Duplicate connection id ${edge.id}`, { edgeId: edge.id });
    edgeIds.add(edge.id);
    if (!byId.has(edge.from) || !byId.has(edge.to)) { add(errors, 'A connection points to a step that does not exist', { edgeId: edge.id }); continue; }
    if (edge.from === edge.to) { add(errors, 'A step cannot connect to itself', { edgeId: edge.id }); continue; }
    outgoing.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
  }
  const starts = nodes.filter((node) => node.type === 'start');
  if (starts.length !== 1) add(errors, starts.length ? 'A flow can have only one Start' : 'Add a Start step');
  if (!nodes.some((node) => node.type === 'end')) add(errors, 'Add an End step');

  const variables = new Set((definition.variables || []).map((item) => item?.name).filter(Boolean));
  for (const item of definition.variables || []) {
    if (!NAME.test(String(item?.name || ''))) add(errors, `Variable name ${item?.name || '(empty)'} must start with a letter and use letters, digits, or _`);
  }
  const outputVars = new Map();

  for (const node of byId.values()) {
    const ins = incoming.get(node.id) || [];
    const outs = outgoing.get(node.id) || [];
    const ref = { nodeId: node.id };
    const label = node.name || node.id;
    const config = node.config || {};
    if (node.type === 'start') {
      if (ins.length) add(errors, 'Start cannot have incoming connections', ref);
      if (outs.length !== 1) add(errors, 'Start needs exactly one outgoing connection', ref);
      const trigger = config.trigger || 'manual';
      if (!TRIGGERS.includes(trigger)) add(errors, 'Start trigger must be manual, schedule, or webhook', ref);
      if (trigger === 'schedule' && !String(config.cron || '').trim()) add(errors, 'A scheduled Start needs a cron expression', ref);
      continue;
    }
    if (!ins.length) add(errors, `${label} is not connected to anything before it`, ref);
    if (node.type === 'end') {
      if (outs.length) add(errors, 'End cannot have outgoing connections', ref);
      continue;
    }
    if (node.type === 'decision') {
      if (outs.length < 2) add(errors, `${label} needs at least two outgoing branches`, ref);
      const defaults = outs.filter((edge) => edge.isDefault);
      if (defaults.length > 1) add(errors, `${label} can have only one default branch`, ref);
      for (const edge of outs) {
        if (edge.isDefault) continue;
        const condition = edge.condition;
        if (!condition || !String(condition.left || '').trim()) add(errors, `Branch to ${byId.get(edge.to)?.name || edge.to} needs a condition (or mark it as the default)`, { nodeId: node.id, edgeId: edge.id });
        else if (!OPERATORS.includes(condition.op)) add(errors, `Branch condition operator must be one of ${OPERATORS.join(', ')}`, { nodeId: node.id, edgeId: edge.id });
      }
      if (!defaults.length) add(warnings, `${label} has no default branch. The run fails if no condition matches.`, ref);
      continue;
    }
    if (node.type === 'parallel') {
      if (outs.length < 2) add(errors, `${label} needs at least two outgoing branches`, ref);
      continue;
    }
    if (outs.length !== 1) add(errors, `${label} needs exactly one outgoing connection`, ref);
    if (node.type === 'join' && ins.length < 2) add(errors, `${label} needs at least two incoming branches`, ref);
    const outputVar = config.outputVar;
    if (outputVar !== undefined && outputVar !== '' && !NAME.test(String(outputVar))) add(errors, `${label}: output variable must start with a letter and use letters, digits, or _`, ref);
    if (outputVar) {
      if (outputVars.has(outputVar)) add(warnings, `${label} and ${outputVars.get(outputVar)} write the same variable ${outputVar}`, ref);
      outputVars.set(outputVar, label);
      if (variables.has(outputVar)) add(warnings, `${label} overwrites the flow variable ${outputVar}`, ref);
    }
    if (node.type === 'robot') {
      if (!config.workflowId) add(errors, `${label}: choose the workflow the robot runs`, ref);
      else if (lookups?.workflows) {
        const workflow = lookups.workflows.get(config.workflowId);
        if (!workflow) add(errors, `${label}: the workflow was not found in this project`, ref);
        else if (workflow.status !== 'published' || !workflow.current_version_id) add(errors, `${label}: ${workflow.name} must be published before the flow can run it`, ref);
      }
      if (config.input != null && (typeof config.input !== 'object' || Array.isArray(config.input))) add(errors, `${label}: input mapping must be key/value pairs`, ref);
      const retries = Number(config.retries ?? 0);
      if (!Number.isInteger(retries) || retries < 0 || retries > 5) add(errors, `${label}: retries must be 0 to 5`, ref);
    }
    if (node.type === 'agent') {
      if (!config.agentId) add(errors, `${label}: choose the agent to run`, ref);
      else if (lookups?.agents) {
        const agent = lookups.agents.get(config.agentId);
        if (!agent) add(errors, `${label}: the agent was not found in this project`, ref);
        else if (agent.status !== 'published' || !agent.current_version_id) add(errors, `${label}: ${agent.name} must be published before the flow can run it`, ref);
      }
      if (config.input != null && (typeof config.input !== 'object' || Array.isArray(config.input))) add(errors, `${label}: input mapping must be key/value pairs`, ref);
      const retries = Number(config.retries ?? 0);
      if (!Number.isInteger(retries) || retries < 0 || retries > 5) add(errors, `${label}: retries must be 0 to 5`, ref);
    }
    if (node.type === 'human') {
      if (!String(config.title || '').trim()) add(errors, `${label}: give the task a title`, ref);
      if (config.taskType && !['approval', 'form', 'validation'].includes(config.taskType)) add(errors, `${label}: task type must be approval, form, or validation`, ref);
      if (config.formFields != null && !Array.isArray(config.formFields)) add(errors, `${label}: form fields must be a list`, ref);
      for (const [index, field] of (config.formFields || []).entries()) {
        if (!NAME.test(String(field?.name || ''))) add(errors, `${label}: form field ${index + 1} needs a name of letters, digits, or _`, ref);
        if (field?.type === 'select' && !(field.options || []).length) add(errors, `${label}: ${field.name || `field ${index + 1}`} needs options`, ref);
      }
      if (config.assigneeUserId && lookups?.users && !lookups.users.has(config.assigneeUserId)) add(errors, `${label}: the assignee is not an active user`, ref);
    }
    if (node.type === 'case') {
      if (!config.caseTypeId) add(errors, `${label}: choose the case type to open`, ref);
      else if (lookups?.caseTypes) {
        const caseType = lookups.caseTypes.get(config.caseTypeId);
        if (!caseType) add(errors, `${label}: the case type was not found in this project`, ref);
        else if (caseType.status !== 'published' || !caseType.current_version_id) add(errors, `${label}: ${caseType.name} must be published before the flow can open cases`, ref);
      }
      if (config.fields != null && (typeof config.fields !== 'object' || Array.isArray(config.fields))) add(errors, `${label}: case fields must be key/value pairs`, ref);
      if (config.priority && !['low', 'medium', 'high', 'critical'].includes(config.priority)) add(errors, `${label}: priority must be low, medium, high, or critical`, ref);
    }
    if (node.type === 'timer') {
      const seconds = Number(config.seconds);
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_TIMER_SECONDS) add(errors, `${label}: delay must be between 1 second and 30 days`, ref);
    }
    if (node.type === 'http') {
      if (!config.connectionId) add(errors, `${label}: choose a REST API connection`, ref);
      else if (lookups?.connections) {
        const connection = lookups.connections.get(config.connectionId);
        if (!connection) add(errors, `${label}: the connection was not found in this project`, ref);
        else if (connection.connector_type !== 'rest_api') add(errors, `${label}: the connection must be a REST API connection`, ref);
      }
      if (!String(config.path || '').trim()) add(errors, `${label}: enter a request path`, ref);
      if (config.method && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(config.method).toUpperCase())) add(errors, `${label}: method must be GET, POST, PUT, PATCH, or DELETE`, ref);
      const retries = Number(config.retries ?? 0);
      if (!Number.isInteger(retries) || retries < 0 || retries > 5) add(errors, `${label}: retries must be 0 to 5`, ref);
    }
  }

  // Reachability from Start and cycle detection (loops are not supported yet).
  if (starts.length === 1 && !errors.some((item) => item.message.includes('does not exist'))) {
    const seen = new Set();
    const stack = [starts[0].id];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const edge of outgoing.get(id) || []) stack.push(edge.to);
    }
    for (const node of byId.values()) {
      if (!seen.has(node.id)) add(errors, `${node.name || node.id} cannot be reached from Start`, { nodeId: node.id });
    }
    const state = new Map();
    let cycle = null;
    const visit = (id) => {
      if (cycle) return;
      state.set(id, 1);
      for (const edge of outgoing.get(id) || []) {
        const mark = state.get(edge.to);
        if (mark === 1) { cycle = edge; return; }
        if (!mark) visit(edge.to);
      }
      state.set(id, 2);
    };
    for (const node of byId.values()) if (!state.get(node.id)) visit(node.id);
    if (cycle) add(errors, 'Loops are not supported yet: remove the connection that goes back to an earlier step', { edgeId: cycle.id, nodeId: cycle.to });
  }
  return { errors, warnings };
}

export function incomingCount(definition, nodeId) {
  return definition.edges.filter((edge) => edge.to === nodeId).length;
}

export function outgoingEdges(definition, nodeId) {
  return definition.edges.filter((edge) => edge.from === nodeId);
}
