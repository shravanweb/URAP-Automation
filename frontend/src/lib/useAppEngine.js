// Runtime state for an app: current page and page inputs, field values and validation errors,
// variables, data source results, running actions, toasts, agent chats, and uploads. The same
// engine powers the published app (/apps/:id), the designer preview (draft), and the designer
// canvas (live data, actions off).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { ACTIONS, COMPONENTS, allComponents, evaluateCondition, renderMapping, renderTemplate, validateFieldValue } from './appDefinition.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FAILED = ['FAILED', 'CANCELLED', 'SKIPPED'];

/** Initial field values for a page (default values may use bindings). */
export function defaultValues(page, context) {
  const values = {};
  for (const component of allComponents(page || {})) {
    if (!COMPONENTS[component.type]?.input || !component.props?.name) continue;
    const raw = renderTemplate(component.props.defaultValue ?? '', context);
    let value;
    if (component.type === 'checkbox') value = raw === true || raw === 'true';
    else if (component.type === 'file_upload') value = null;
    else if (component.type === 'number') value = raw === '' || raw === null || raw === undefined || Number.isNaN(Number(raw)) ? '' : Number(raw);
    else value = raw === null || raw === undefined ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
    values[component.props.name] = value;
  }
  return values;
}

/** What the browser sends for a server action: the action's mappings rendered with the context. */
export function actionPayload(action, context) {
  const config = action.config || {};
  switch (action.type) {
    case 'run_workflow':
    case 'start_flow':
      return { inputs: renderMapping(config.inputs, context) };
    case 'run_agent':
      return { inputs: renderMapping(config.inputs, context), message: String(renderTemplate(config.message || '', context) ?? '') };
    case 'add_queue_item':
      return { reference: renderTemplate(config.reference || '', context) || null, content: renderMapping(config.content, context) };
    case 'create_task':
      return { title: renderTemplate(config.title || '', context), description: renderTemplate(config.description || '', context), data: renderMapping(config.data, context) };
    case 'create_case':
      return { title: renderTemplate(config.title || '', context), fields: renderMapping(config.fields, context) };
    case 'call_http':
      return { path: String(renderTemplate(config.path || '/', context) ?? ''), query: renderMapping(config.query, context), body: renderMapping(config.body, context) };
    default:
      return {};
  }
}

/** Field errors for a form submit: { componentId: message }. Hidden fields are skipped. */
export function validateForm(form, values, { busy = {}, isVisible = () => true } = {}) {
  const found = {};
  for (const field of (form?.children || []).filter((child) => COMPONENTS[child.type]?.input)) {
    if (!isVisible(field)) continue;
    if (busy[field.id]) { found[field.id] = 'Wait for the upload to finish'; continue; }
    const message = validateFieldValue(field, values?.[field.props?.name]);
    if (message) found[field.id] = message;
  }
  return found;
}

/**
 * Waits for a started job / flow run / agent run when the action asks to, then turns failures
 * into errors. `poll(kind, id)` fetches the latest state.
 */
export async function settleResult(action, started, poll, { wait = sleep, now = Date.now } = {}) {
  const label = ACTIONS[action.type]?.label || action.type;
  let result = started;
  const waits = action.config?.wait !== false && ['job', 'flow_run', 'agent_run'].includes(result.kind);
  if (waits && !result.done) {
    const deadline = now() + Math.min(600, Math.max(5, Number(action.config?.timeoutSeconds) || 120)) * 1000;
    while (!result.done) {
      if (now() > deadline) throw new Error(`${label} is still running. Check back later.`);
      await wait(1000);
      result = await poll(result.kind, result.id);
    }
  }
  if (FAILED.includes(result.status)) throw new Error(result.error ? `${label} failed: ${result.error}` : `${label} ${String(result.status).toLowerCase()}`);
  if (result.kind === 'http' && Number(result.status) >= 400) throw new Error(`The API answered ${result.status}`);
  if (result.kind === 'agent_run' && Array.isArray(result.messages)) result = { ...result, reply: [...result.messages].reverse().find((item) => item.role === 'assistant')?.content || '' };
  return result;
}

/**
 * Runs an event's actions in order. Each action sees the previous result as {{result}}. Server
 * actions go through `runServer(action, payload)`; the rest call the handlers. Throws on the
 * first failure (the remaining actions do not run).
 */
export async function runActionChain(actions, { getContext, runServer, navigate, setVariable, refresh, toast }) {
  let result = null;
  for (const action of actions || []) {
    const actionContext = getContext({ result });
    const config = action.config || {};
    if (ACTIONS[action.type]?.server) {
      result = await runServer(action, actionPayload(action, actionContext));
    } else if (action.type === 'navigate') {
      result = { pageId: config.pageId };
      navigate(config.pageId, renderMapping(config.inputs, actionContext));
    } else if (action.type === 'set_variable') {
      result = renderTemplate(config.value ?? '', actionContext);
      setVariable(config.name, result);
    } else if (action.type === 'refresh_data') {
      result = await refresh(config.sourceId);
    } else if (action.type === 'show_toast') {
      toast(renderTemplate(config.message || '', actionContext), config.tone || 'success');
    }
    if (action.resultVar) setVariable(action.resultVar, result);
  }
  return result;
}

export function useAppEngine({ appId, definition, app, user, preview = false, interactive = true, initialPageId = null, initialPageInputs = null, onPageChange = null, dataSources = null }) {
  const pages = useMemo(() => definition?.pages || [], [definition]);
  const [pageId, setPageId] = useState(() => (initialPageId && pages.some((item) => item.id === initialPageId) ? initialPageId : pages[0]?.id));
  const [pageInputs, setPageInputs] = useState(initialPageInputs || {});
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [vars, setVars] = useState(() => Object.fromEntries((definition?.variables || []).map((item) => [item.name, item.defaultValue ?? null])));
  const [data, setData] = useState({});
  const [busy, setBusyState] = useState({});
  const [toasts, setToasts] = useState([]);
  const [chats, setChats] = useState({});
  const live = useRef({});
  live.current = { values, vars, data, pageId, pageInputs };
  const page = pages.find((item) => item.id === pageId) || pages[0] || null;
  const base = `/api/apps/${appId}/runtime`;
  const query = preview ? '?preview=1' : '';

  // The designer removes pages while the engine is mounted.
  useEffect(() => { if (pages.length && !pages.some((item) => item.id === pageId)) setPageId(pages[0].id); }, [pages, pageId]);

  const buildContext = useCallback((state, extra = {}) => {
    const current = pages.find((item) => item.id === state.pageId) || pages[0];
    return {
      app: { id: appId, name: app?.name || '', user: user || {} },
      page: { id: current?.id, name: current?.name, inputs: state.pageInputs || {} },
      inputs: state.values[current?.id] || {},
      vars: state.vars,
      data: state.data,
      ...extra,
    };
  }, [pages, appId, app?.name, user]);
  const context = useCallback((extra) => buildContext(live.current, extra), [buildContext]);
  const renderContext = useMemo(() => buildContext({ values, vars, data, pageId, pageInputs }), [buildContext, values, vars, data, pageId, pageInputs]);

  const toast = useCallback((message, tone = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((list) => [...list.slice(-3), { id, message: String(message || ''), tone }]);
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), tone === 'error' ? 7000 : 4500);
  }, []);
  const dismissToast = useCallback((id) => setToasts((list) => list.filter((item) => item.id !== id)), []);
  const setBusy = (id, value) => setBusyState((state) => ({ ...state, [id]: value }));
  const assignVar = useCallback((name, value) => { live.current.vars = { ...live.current.vars, [name]: value }; setVars(live.current.vars); }, []);
  const setDataEntry = useCallback((name, entry) => {
    const next = typeof entry === 'function' ? entry(live.current.data[name]) : entry;
    live.current.data = { ...live.current.data, [name]: next };
    setData(live.current.data);
  }, []);

  // Default field values whenever a page is shown for the first time.
  useEffect(() => {
    if (!page || live.current.values[page.id]) return;
    const next = { ...live.current.values, [page.id]: defaultValues(page, context()) };
    live.current.values = next;
    setValues(next);
  }, [page, context]);

  const loadSource = useCallback(async (source) => {
    if (!source || !appId) return;
    setDataEntry(source.name, (prev) => ({ rows: [], count: 0, ...(prev || {}), loading: true, error: null }));
    try {
      const result = await api(`${base}/data/${source.id}${query}`, { method: 'POST', body: { query: renderMapping(source.config?.query, context()) } });
      setDataEntry(source.name, { ...result.data, loading: false, error: null });
    } catch (error) {
      setDataEntry(source.name, (prev) => ({ rows: [], count: 0, ...(prev || {}), loading: false, error: error.message }));
    }
  }, [appId, base, query, context, setDataEntry]);

  // The designer passes the saved data sources (the server runs saved sources only).
  const sourceList = dataSources || definition?.dataSources || [];
  const sourcesKey = JSON.stringify(sourceList);
  useEffect(() => {
    if (!appId) return;
    for (const source of sourceList) if (source.autoLoad !== false) loadSource(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, preview, sourcesKey]);

  const goTo = useCallback((nextPageId, inputs = {}) => {
    if (!pages.some((item) => item.id === nextPageId)) return;
    live.current.pageId = nextPageId;
    live.current.pageInputs = inputs;
    setPageId(nextPageId);
    setPageInputs(inputs);
    setErrors({});
    onPageChange?.(nextPageId, inputs);
  }, [pages, onPageChange]);

  const setValue = useCallback((name, value, componentId = null) => {
    const current = live.current.pageId;
    const next = { ...live.current.values, [current]: { ...(live.current.values[current] || {}), [name]: value } };
    live.current.values = next;
    setValues(next);
    if (componentId) setErrors((state) => (state[componentId] ? { ...state, [componentId]: null } : state));
  }, []);

  const runActions = useCallback(async (component, event) => {
    const actions = component?.events?.[event] || [];
    if (!interactive || !actions.length) return true;
    setBusy(component.id, true);
    try {
      await runActionChain(actions, {
        getContext: context,
        runServer: async (action, payload) => {
          const response = await api(`${base}/actions${query}`, { method: 'POST', body: { componentId: component.id, event, actionId: action.id, values: payload } });
          return settleResult(action, response.data, async (kind, id) => (await api(`${base}/runs/${kind}/${id}${query}`)).data);
        },
        navigate: goTo,
        setVariable: assignVar,
        refresh: async (sourceId) => {
          const source = (definition?.dataSources || []).find((item) => item.id === sourceId);
          await loadSource(source);
          return source ? live.current.data[source.name] : null;
        },
        toast,
      });
      return true;
    } catch (error) {
      toast(error.message || 'Something went wrong', 'error');
      return false;
    } finally {
      setBusy(component.id, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, context, goTo, assignVar, loadSource, toast, definition, base, query]);

  const submitForm = useCallback(async (form) => {
    if (!interactive) return false;
    const fields = (form.children || []).filter((child) => COMPONENTS[child.type]?.input);
    const found = validateForm(form, live.current.values[live.current.pageId] || {}, { busy, isVisible: (field) => evaluateCondition(field.visibleWhen, context()) });
    setErrors((state) => ({ ...Object.fromEntries(Object.entries(state).filter(([id]) => !fields.some((field) => field.id === id))), ...found }));
    if (Object.keys(found).length) return false;
    const ok = await runActions(form, 'onSubmit');
    if (ok && form.props?.resetOnSubmit) {
      const defaults = defaultValues({ components: fields }, context());
      const pageKey = live.current.pageId;
      const next = { ...live.current.values, [pageKey]: { ...(live.current.values[pageKey] || {}), ...defaults } };
      live.current.values = next;
      setValues(next);
    }
    return ok;
  }, [interactive, busy, runActions, context]);

  const setChat = (id, update) => setChats((state) => ({ ...state, [id]: typeof update === 'function' ? update(state[id] || {}) : update }));
  const sendChat = useCallback(async (component, message) => {
    if (!interactive || !message.trim()) return;
    const runId = chats[component.id]?.runId || null;
    setChat(component.id, (state) => ({ ...state, busy: true, error: null, messages: [...(state.messages || []), { id: `local-${Date.now()}`, role: 'user', content: message }] }));
    try {
      let run = (await api(`${base}/agent-chat${query}`, { method: 'POST', body: { componentId: component.id, message, ...(runId ? { runId } : {}) } })).data;
      const deadline = Date.now() + 180000;
      while (!run.done && Date.now() < deadline) {
        setChat(component.id, (state) => ({ ...state, runId: run.id, messages: run.messages?.length ? run.messages : state.messages }));
        await sleep(1000);
        run = (await api(`${base}/runs/agent_run/${run.id}${query}`)).data;
      }
      setChat(component.id, { runId: run.status === 'IDLE' ? run.id : null, messages: run.messages || [], busy: false, error: FAILED.includes(run.status) ? (run.error || 'The agent could not answer') : run.done ? null : 'The agent is taking longer than expected' });
    } catch (error) {
      setChat(component.id, (state) => ({ ...state, busy: false, error: error.message }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, chats, base, query]);

  const uploadFile = useCallback(async (component, file) => {
    if (!interactive || !file) return;
    const body = new FormData();
    body.append('file', file);
    setBusy(component.id, true);
    setErrors((state) => ({ ...state, [component.id]: null }));
    try {
      const result = await api(`${base}/files${query}`, { method: 'POST', body });
      setValue(component.props.name, result.data, component.id);
    } catch (error) {
      setErrors((state) => ({ ...state, [component.id]: error.message }));
    } finally {
      setBusy(component.id, false);
    }
  }, [interactive, base, query, setValue]);

  const isVisible = useCallback((component) => evaluateCondition(component.visibleWhen, renderContext), [renderContext]);

  return {
    appId, preview, interactive, pages, page, pageId: page?.id, goTo, context: renderContext,
    values: values[page?.id] || {}, setValue, errors, busy, toasts, toast, dismissToast,
    runActions, submitForm, isVisible, loadSource, data, chats, sendChat, uploadFile,
  };
}
