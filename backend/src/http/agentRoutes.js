// Agent API: CRUD for agents (draft + published versions), AI provider status, runs (conversations
// and autonomous runs) with messages and tool-call traces, cancel/end. Same auth, permissions,
// project scoping, and audit log as flows and workflows.
import crypto from 'node:crypto';
import { z } from 'zod';
import { writeAudit } from '../db/audit.js';
import { AppError, validationError } from '../lib/errors.js';
import { AGENT_TYPES, defaultAgentConfig, validateAgentConfig } from '../agent/config.js';
import { PROVIDERS, describeProvider, resolveProvider } from '../agent/providers.js';
import { advanceAgentRun, cancelAgentRun, endConversation, kickAgentRun, postAgentMessage, startAgentRun } from '../agent/runtime.js';
import { can } from '../lib/permissions.js';

const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

const fieldSchema = z.object({
  name: z.string().max(63),
  type: z.string().max(20),
  description: z.string().max(500).optional().default(''),
  required: z.boolean().optional().default(false),
});
const configSchema = z.object({
  instructions: z.string().max(20000).default(''),
  connectionId: z.string().uuid().nullable().optional().default(null),
  model: z.string().max(120).optional().default(''),
  temperature: z.number().finite(),
  maxSteps: z.number().finite(),
  maxTokens: z.number().finite(),
  maxTotalTokens: z.number().finite(),
  toolTimeoutMinutes: z.number().finite(),
  greeting: z.string().max(1000).optional().default(''),
  tools: z.array(z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    type: z.string().max(20),
    name: z.string().max(64),
    description: z.string().max(1000).optional().default(''),
  }).passthrough()).max(20).default([]),
  inputSchema: z.array(fieldSchema).max(30).default([]),
  outputSchema: z.array(fieldSchema).max(30).default([]),
});

export function presentAgent(row, extra = {}) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name || undefined,
    name: row.name,
    description: row.description || '',
    agentType: row.agent_type,
    status: row.status,
    currentVersionId: row.current_version_id,
    versionNumber: row.version_number ?? undefined,
    config: parse(row.draft_json),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRun: row.last_run_id ? { id: row.last_run_id, status: row.last_run_status, startedAt: row.last_run_started_at } : null,
    runCount: row.run_count != null ? Number(row.run_count) : undefined,
    ...extra,
  };
}

export function presentAgentRun(row) {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name || undefined,
    agentType: row.agent_type || undefined,
    projectId: row.project_id,
    versionId: row.agent_version_id,
    versionNumber: row.version_number ?? null,
    mode: row.mode,
    source: row.source,
    status: row.status,
    title: row.title,
    input: parse(row.input_json) || {},
    output: parse(row.output_json),
    error: row.error_message,
    providerLabel: row.provider_label,
    steps: row.steps,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.prompt_tokens + row.completion_tokens,
    flowRunId: row.flow_run_id,
    toolTypes: Object.fromEntries((parse(row.config_json)?.tools || []).map((tool) => [tool.name, tool.type])),
    startedBy: row.started_by,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

export function presentMessage(row) {
  return {
    id: row.id, seq: Number(row.seq), role: row.role, content: row.content, toolCalls: parse(row.tool_calls_json) || [],
    toolCallId: row.tool_call_id, toolName: row.tool_name, toolArgs: parse(row.tool_args_json), status: row.status,
    jobId: row.job_id, taskId: row.task_id, promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens,
    durationMs: row.duration_ms, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function registerAgentRoutes(app, { pool, cfg, wrap, paging, requireUser, requirePermission, loadProject, scope, scopeSql, like }) {
  const AGENT_SELECT = `SELECT a.*, p.name AS project_name, v.version_number,
      r.id AS last_run_id, r.status AS last_run_status, r.started_at AS last_run_started_at,
      (SELECT COUNT(*) FROM agent_runs c WHERE c.agent_id = a.id) AS run_count
    FROM agents a
    JOIN projects p ON p.id = a.project_id
    LEFT JOIN agent_versions v ON v.id = a.current_version_id
    LEFT JOIN agent_runs r ON r.id = (SELECT r2.id FROM agent_runs r2 WHERE r2.agent_id = a.id ORDER BY r2.created_at DESC LIMIT 1)`;

  async function loadAgent(user, id, writable = false) {
    const [rows] = await pool.query(`${AGENT_SELECT} WHERE a.id = ? AND a.tenant_id = ?`, [id, user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Agent not found');
    await loadProject(user, rows[0].project_id, writable);
    return rows[0];
  }

  async function lookups(projectId, tenantId) {
    const [workflows] = await pool.query(`SELECT id, name, status, current_version_id FROM workflows WHERE project_id = ?`, [projectId]);
    const [connections] = await pool.query(`SELECT id, connector_type FROM connections WHERE project_id = ?`, [projectId]);
    const [users] = await pool.query(`SELECT id FROM users WHERE tenant_id = ? AND status = 'active'`, [tenantId]);
    const [caseTypes] = await pool.query(`SELECT id, name, status FROM case_types WHERE project_id = ?`, [projectId]);
    return {
      caseTypes: new Map(caseTypes.map((row) => [row.id, row])),
      workflows: new Map(workflows.map((row) => [row.id, row])),
      connections: new Map(connections.map((row) => [row.id, row])),
      users: new Set(users.map((row) => row.id)),
    };
  }

  async function aiStatus(projectId, connectionId = null) {
    const [rows] = await pool.query(`SELECT id, name, config_json, status, last_error FROM connections WHERE project_id = ? AND connector_type = 'ai_provider' ORDER BY created_at`, [projectId]);
    let settings = null;
    let error = null;
    try { settings = await resolveProvider(pool, cfg, { projectId, connectionId }); } catch (err) { error = err.message; }
    return {
      configured: Boolean(settings),
      active: describeProvider(settings),
      error,
      envDefault: Boolean(cfg.ai?.provider),
      connections: rows.map((row) => {
        const config = parse(row.config_json) || {};
        return { id: row.id, name: row.name, provider: config.provider, providerLabel: PROVIDERS[config.provider]?.label || config.provider, model: config.model, baseUrl: config.baseUrl || '', status: row.status, lastError: row.last_error };
      }),
      providers: Object.entries(PROVIDERS).filter(([key]) => key !== 'mock' || cfg.ai?.allowMock).map(([key, meta]) => ({ id: key, label: meta.label, baseUrl: meta.baseUrl, needsKey: meta.needsKey })),
    };
  }

  app.get('/api/ai/status', requireUser, wrap(async (req, res) => {
    const projectId = String(req.query.projectId || '');
    if (!projectId) throw new AppError(400, 'VALIDATION', 'projectId is required');
    await loadProject(req.user, projectId);
    res.json({ data: await aiStatus(projectId, req.query.connectionId ? String(req.query.connectionId) : null) });
  }));

  app.get('/api/agents', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const range = await scope(req.user);
    const visible = scopeSql(range, 'a.project_id');
    const where = ['a.tenant_id = ?', visible.sql];
    const params = [req.user.tenant_id, ...visible.params];
    if (req.query.projectId) { where.push('a.project_id = ?'); params.push(String(req.query.projectId)); }
    if (req.query.status) { where.push('a.status = ?'); params.push(String(req.query.status)); }
    if (req.query.search) { where.push(`a.name LIKE ? ESCAPE '\\\\'`); params.push(like(req.query.search)); }
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM agents a WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(`${AGENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.updated_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ data: rows.map((row) => presentAgent(row)), meta: { limit, offset, total: Number(count.total) } });
  }));

  app.post('/api/agents', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const body = z.object({
      projectId: z.string().uuid(),
      name: z.string().trim().min(1).max(200),
      description: z.string().max(4000).optional().default(''),
      agentType: z.enum(AGENT_TYPES).default('conversational'),
    }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const project = await loadProject(req.user, body.data.projectId, true);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO agents (id, tenant_id, project_id, name, description, agent_type, status, draft_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, project.tenant_id, project.id, body.data.name, body.data.description, body.data.agentType, JSON.stringify(defaultAgentConfig(body.data.agentType)), req.user.id],
    );
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'agent.create', entityType: 'agent', entityId: id, projectId: project.id, ip: req.ip, metadata: { agentType: body.data.agentType } });
    res.status(201).json({ data: presentAgent(await loadAgent(req.user, id)) });
  }));

  app.get('/api/agents/:id', requireUser, wrap(async (req, res) => {
    const agent = await loadAgent(req.user, req.params.id);
    const [versions] = await pool.query(`SELECT id, version_number, published_by, published_at FROM agent_versions WHERE agent_id = ? ORDER BY version_number DESC`, [agent.id]);
    const validation = validateAgentConfig(parse(agent.draft_json), await lookups(agent.project_id, agent.tenant_id), agent.agent_type);
    res.json({
      data: presentAgent(agent, {
        validation,
        versions: versions.map((row) => ({ id: row.id, versionNumber: row.version_number, publishedBy: row.published_by, publishedAt: row.published_at })),
      }),
    });
  }));

  app.patch('/api/agents/:id', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const agent = await loadAgent(req.user, req.params.id, true);
    const body = z.object({ name: z.string().trim().min(1).max(200).optional(), description: z.string().max(4000).optional() }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    await pool.query(`UPDATE agents SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [body.data.name ?? null, body.data.description ?? null, agent.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'agent.update', entityType: 'agent', entityId: agent.id, projectId: agent.project_id, ip: req.ip });
    res.json({ data: presentAgent(await loadAgent(req.user, agent.id)) });
  }));

  app.put('/api/agents/:id/draft', requireUser, requirePermission('workflows.write'), wrap(async (req, res) => {
    const agent = await loadAgent(req.user, req.params.id, true);
    const body = z.object({ config: configSchema }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const text = JSON.stringify(body.data.config);
    if (text.length > 200000) throw new AppError(400, 'VALIDATION', 'The agent configuration is too large');
    await pool.query(`UPDATE agents SET draft_json = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [text, agent.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'agent.save_draft', entityType: 'agent', entityId: agent.id, projectId: agent.project_id, ip: req.ip, metadata: { tools: body.data.config.tools.length } });
    const validation = validateAgentConfig(body.data.config, await lookups(agent.project_id, agent.tenant_id), agent.agent_type);
    res.json({ data: presentAgent(await loadAgent(req.user, agent.id), { validation }) });
  }));

  app.post('/api/agents/:id/publish', requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
    const agent = await loadAgent(req.user, req.params.id, true);
    const config = parse(agent.draft_json);
    const validation = validateAgentConfig(config, await lookups(agent.project_id, agent.tenant_id), agent.agent_type);
    if (validation.errors.length) throw new AppError(400, 'VALIDATION', 'Fix the agent before publishing', validation.errors);
    const [[max]] = await pool.query(`SELECT COALESCE(MAX(version_number), 0) AS n FROM agent_versions WHERE agent_id = ?`, [agent.id]);
    const versionId = crypto.randomUUID();
    const versionNumber = Number(max.n) + 1;
    await pool.query(`INSERT INTO agent_versions (id, agent_id, version_number, config_json, published_by, published_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`, [versionId, agent.id, versionNumber, JSON.stringify(config), req.user.id]);
    await pool.query(`UPDATE agents SET status = 'published', current_version_id = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [versionId, agent.id]);
    await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: 'agent.publish', entityType: 'agent', entityId: agent.id, projectId: agent.project_id, ip: req.ip, metadata: { version: versionNumber } });
    res.json({ data: presentAgent(await loadAgent(req.user, agent.id), { validation }) });
  }));

  for (const [action, status] of [['disable', 'disabled'], ['enable', 'published']]) {
    app.post(`/api/agents/:id/${action}`, requireUser, requirePermission('workflows.publish'), wrap(async (req, res) => {
      const agent = await loadAgent(req.user, req.params.id, true);
      if (status === 'published' && !agent.current_version_id) throw new AppError(409, 'INVALID_STATE', 'Publish the agent before enabling it');
      await pool.query(`UPDATE agents SET status = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`, [status, agent.id]);
      await writeAudit(pool, { tenantId: req.user.tenant_id, userId: req.user.id, action: `agent.${action}`, entityType: 'agent', entityId: agent.id, projectId: agent.project_id, ip: req.ip });
      res.json({ data: presentAgent(await loadAgent(req.user, agent.id)) });
    }));
  }

  // Start a conversation or an autonomous run. { test: true } uses the draft (builders only).
  app.post('/api/agents/:id/runs', requireUser, wrap(async (req, res) => {
    const body = z.object({
      test: z.boolean().optional().default(false),
      input: z.record(z.any()).optional().default({}),
      message: z.string().max(20000).optional().default(''),
      wait: z.boolean().optional().default(false),
    }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const { test } = body.data;
    if (!can(req.user.role, test ? 'workflows.write' : 'jobs.run')) throw new AppError(403, 'FORBIDDEN', 'Your role cannot run this agent');
    const agent = await loadAgent(req.user, req.params.id, test);
    let config;
    let versionId = null;
    if (test) {
      config = parse(agent.draft_json);
      const validation = validateAgentConfig(config, await lookups(agent.project_id, agent.tenant_id), agent.agent_type);
      if (validation.errors.length) throw new AppError(400, 'VALIDATION', 'Fix the agent before testing it', validation.errors);
    } else {
      if (agent.status !== 'published' || !agent.current_version_id) throw new AppError(409, 'AGENT_NOT_PUBLISHED', 'Publish the agent before running it');
      const [versions] = await pool.query(`SELECT * FROM agent_versions WHERE id = ?`, [agent.current_version_id]);
      config = parse(versions[0].config_json);
      versionId = agent.current_version_id;
    }
    const mode = agent.agent_type === 'conversational' ? 'chat' : 'task';
    const run = await startAgentRun(pool, cfg, {
      agent, config, versionId, user: req.user, input: body.data.input, message: body.data.message, mode,
      source: test ? 'test' : (mode === 'chat' ? 'chat' : 'api'), background: !body.data.wait,
    });
    res.status(body.data.wait ? 200 : 202).json({ data: presentAgentRun(await loadRunRow(run.id)) });
  }));

  const RUN_SELECT = `SELECT r.*, a.name AS agent_name, a.agent_type, v.version_number FROM agent_runs r JOIN agents a ON a.id = r.agent_id LEFT JOIN agent_versions v ON v.id = r.agent_version_id`;

  async function loadRunRow(id) {
    const [rows] = await pool.query(`${RUN_SELECT} WHERE r.id = ?`, [id]);
    return rows[0];
  }

  async function loadRun(user, id) {
    const [rows] = await pool.query(`${RUN_SELECT} WHERE r.id = ? AND r.tenant_id = ?`, [id, user.tenant_id]);
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Agent run not found');
    await loadProject(user, rows[0].project_id);
    return rows[0];
  }

  const ownsOr = (user, run, permission) => run.started_by === user.id || can(user.role, permission);

  app.get('/api/agent-runs', requireUser, wrap(async (req, res) => {
    const { limit, offset } = paging(req.query);
    const range = await scope(req.user);
    const visible = scopeSql(range, 'r.project_id');
    const where = ['r.tenant_id = ?', visible.sql];
    const params = [req.user.tenant_id, ...visible.params];
    for (const [key, column] of [['agentId', 'r.agent_id'], ['projectId', 'r.project_id'], ['status', 'r.status'], ['source', 'r.source']]) {
      if (req.query[key]) { where.push(`${column} = ?`); params.push(String(req.query[key])); }
    }
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM agent_runs r WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.query(`${RUN_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ data: rows.map(presentAgentRun), meta: { limit, offset, total: Number(count.total) } });
  }));

  app.get('/api/agent-runs/:id', requireUser, wrap(async (req, res) => {
    const run = await loadRun(req.user, req.params.id);
    // Keep the trace live between worker ticks (never blocks: the advance runs in the background).
    if (['RUNNING', 'WAITING'].includes(run.status)) kickAgentRun(pool, cfg, run.id);
    const [messages] = await pool.query(`SELECT * FROM agent_messages WHERE run_id = ? ORDER BY seq`, [run.id]);
    res.json({ data: { ...presentAgentRun(run), messages: messages.map(presentMessage) } });
  }));

  app.post('/api/agent-runs/:id/messages', requireUser, wrap(async (req, res) => {
    const body = z.object({ content: z.string().trim().min(1).max(20000), wait: z.boolean().optional().default(false) }).safeParse(req.body || {});
    if (!body.success) throw validationError(body.error.issues);
    const run = await loadRun(req.user, req.params.id);
    if (run.started_by !== req.user.id && req.user.role !== 'administrator') throw new AppError(403, 'FORBIDDEN', 'Only the person who started this conversation can continue it');
    await postAgentMessage(pool, cfg, run, req.user, body.data.content, { background: !body.data.wait });
    res.status(body.data.wait ? 200 : 202).json({ data: presentAgentRun(await loadRun(req.user, run.id)) });
  }));

  app.post('/api/agent-runs/:id/cancel', requireUser, wrap(async (req, res) => {
    const run = await loadRun(req.user, req.params.id);
    if (!ownsOr(req.user, run, 'jobs.control')) throw new AppError(403, 'FORBIDDEN', 'Your role cannot cancel this run');
    await cancelAgentRun(pool, cfg, run, req.user);
    res.json({ data: presentAgentRun(await loadRun(req.user, run.id)) });
  }));

  app.post('/api/agent-runs/:id/end', requireUser, wrap(async (req, res) => {
    const run = await loadRun(req.user, req.params.id);
    if (!ownsOr(req.user, run, 'jobs.control')) throw new AppError(403, 'FORBIDDEN', 'Your role cannot end this conversation');
    await endConversation(pool, run, req.user);
    res.json({ data: presentAgentRun(await loadRun(req.user, run.id)) });
  }));

  return { advanceAgentRun: (id) => advanceAgentRun(pool, cfg, id) };
}
