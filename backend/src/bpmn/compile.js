// BPMN 2.0 -> URAP Flow compiler. Pure functions only (no database, no DOM), so the modeler in the
// browser and the publish check on the server give the same answer.
//
// A BPMN process is executed by compiling it to a Flow definition and running it on the Flow
// engine (durable node state, jobs, Action Center tasks, timers, webhooks, schedules):
//   start event (none / timer / message)   -> Start (manual / schedule / webhook)
//   user task, manual task                 -> Human task (lane -> assigned role or person)
//   service task                           -> Robot (workflow), Agent, HTTP call, or Case
//   exclusive gateway (split)              -> Decision, conditions from the sequence flows
//   exclusive gateway (merge only)         -> removed; its incoming flows go straight on
//   parallel gateway (split / merge)       -> Parallel / Join
//   intermediate timer catch event         -> Timer
//   end event (none / message)             -> End
//   embedded subprocess                    -> inlined (its start and end become pass-throughs)
//   annotations, associations, groups, data objects, empty pools -> ignored (documentation)
// Anything else is reported as unsupported with the element id, so the modeler can mark it.

export const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
export const BPMNDI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';
export const DC_NS = 'http://www.omg.org/spec/DD/20100524/DC';
export const URAP_NS = 'http://urap.dev/schema/bpmn/1.0';
export const SERVICE_KINDS = ['workflow', 'agent', 'http', 'case'];
export const LANE_ROLES = ['administrator', 'project_manager', 'automation_developer', 'operator'];
const MAX_XML = 2 * 1024 * 1024;
const MAX_TIMER_SECONDS = 30 * 24 * 3600;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;

// ---- A small, strict XML reader --------------------------------------------------------------

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function decode(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (match, code) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code] ?? match;
  });
}

/**
 * Parses XML into { name, prefix, local, ns, attrs, children, text }. Namespace prefixes are
 * resolved, so `ns` is the namespace URI. Rejects DOCTYPE (no entity expansion) and malformed input.
 */
export function parseXml(xml) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('The file is empty');
  if (xml.length > MAX_XML) throw new Error('The BPMN file is larger than 2 MB');
  if (/<!DOCTYPE/i.test(xml)) throw new Error('BPMN files with a DOCTYPE are not accepted');
  const root = { children: [], scope: { xml: 'http://www.w3.org/XML/1998/namespace' } };
  const stack = [root];
  let index = 0;
  const length = xml.length;
  while (index < length) {
    const lt = xml.indexOf('<', index);
    if (lt === -1) { pushText(stack, xml.slice(index)); break; }
    if (lt > index) pushText(stack, xml.slice(index, lt));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) throw new Error('Unclosed comment');
      index = end + 3; continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) throw new Error('Unclosed CDATA section');
      const parent = stack[stack.length - 1];
      if (parent !== root) parent.text += xml.slice(lt + 9, end);
      index = end + 3; continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end === -1) throw new Error('Unclosed processing instruction');
      index = end + 2; continue;
    }
    if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt);
      if (end === -1) throw new Error('Unclosed end tag');
      const name = xml.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open === root || open.name !== name) throw new Error(`Unexpected </${name}>`);
      index = end + 1; continue;
    }
    // Start tag: read up to the matching '>' outside quotes.
    let cursor = lt + 1;
    let quote = null;
    while (cursor < length) {
      const ch = xml[cursor];
      if (quote) { if (ch === quote) quote = null; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '>') break;
      cursor += 1;
    }
    if (cursor >= length) throw new Error('Unclosed start tag');
    let body = xml.slice(lt + 1, cursor);
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1);
    const nameMatch = /^([A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?)/.exec(body);
    if (!nameMatch) throw new Error('Invalid tag name');
    const name = nameMatch[1];
    const rawAttrs = {};
    const attrPattern = /\s+([A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?)\s*=\s*("([^"]*)"|'([^']*)')/g;
    const rest = body.slice(name.length);
    let consumed = 0;
    let match;
    while ((match = attrPattern.exec(rest))) {
      if (match.index !== consumed) throw new Error(`Invalid attribute in <${name}>`);
      rawAttrs[match[1]] = decode(match[3] ?? match[4] ?? '');
      consumed = attrPattern.lastIndex;
    }
    if (rest.slice(consumed).trim()) throw new Error(`Invalid attribute in <${name}>`);
    const parent = stack[stack.length - 1];
    const scope = { ...parent.scope };
    for (const [key, value] of Object.entries(rawAttrs)) {
      if (key === 'xmlns') scope[''] = value;
      else if (key.startsWith('xmlns:')) scope[key.slice(6)] = value;
    }
    const [prefix, local] = name.includes(':') ? name.split(':') : ['', name];
    const attrs = {};
    for (const [key, value] of Object.entries(rawAttrs)) {
      if (key === 'xmlns' || key.startsWith('xmlns:')) continue;
      if (key.includes(':')) {
        const [p, l] = key.split(':');
        attrs[`${scope[p] || p}|${l}`] = value;
      } else attrs[key] = value;
    }
    const element = { name, prefix, local, ns: scope[prefix] || '', attrs, children: [], text: '', scope, parent: parent === root ? null : parent };
    parent.children.push(element);
    if (!selfClosing) stack.push(element);
    index = cursor + 1;
  }
  if (stack.length !== 1) throw new Error(`<${stack[stack.length - 1].name}> is not closed`);
  const elements = root.children.filter((child) => typeof child === 'object');
  if (elements.length !== 1) throw new Error('The file must have exactly one root element');
  return elements[0];
}

function pushText(stack, text) {
  const top = stack[stack.length - 1];
  if (top.name) top.text += decode(text);
  else if (text.trim()) throw new Error('Text outside the root element');
}

const kids = (element, local, ns = BPMN_NS) => element.children.filter((child) => child.local === local && child.ns === ns);
const kid = (element, local, ns = BPMN_NS) => kids(element, local, ns)[0] || null;
const urap = (element, key) => element.attrs[`${URAP_NS}|${key}`];

// ---- Helpers ---------------------------------------------------------------------------------

/** "PT1H30M", "P2D", "PT45S" -> seconds, or null. */
export function isoDurationSeconds(text) {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(text || '').trim());
  if (!match || String(text).trim() === 'P' || String(text).trim().endsWith('T')) return null;
  const [, w, d, h, m, s] = match;
  return Math.round((Number(w || 0) * 7 * 86400) + (Number(d || 0) * 86400) + (Number(h || 0) * 3600) + (Number(m || 0) * 60) + Number(s || 0));
}

/** BPMN timeCycle -> cron. Accepts a 5-field cron expression or a simple ISO repeat like R/PT15M. */
export function cycleToCron(text) {
  const value = String(text || '').trim();
  if (/^(\S+\s+){4}\S+$/.test(value)) return value;
  const match = /^R\d*\/(P.+)$/.exec(value);
  if (!match) return null;
  const seconds = isoDurationSeconds(match[1]);
  if (!seconds) return null;
  if (seconds % 604800 === 0 && seconds / 604800 === 1) return '0 0 * * 1';
  if (seconds === 86400) return '0 0 * * *';
  if (seconds % 3600 === 0 && 24 % (seconds / 3600) === 0) return seconds === 3600 ? '0 * * * *' : `0 */${seconds / 3600} * * *`;
  if (seconds % 60 === 0 && 60 % (seconds / 60) === 0) return seconds === 60 ? '* * * * *' : `*/${seconds / 60} * * * *`;
  return null;
}

const OPS = { '==': 'eq', '===': 'eq', '!=': 'neq', '!==': 'neq', '>=': 'gte', '<=': 'lte', '>': 'gt', '<': 'lt' };
/** "${vars.review.outcome == 'approve'}" -> { left, op, right }, or null. */
export function parseConditionExpression(text) {
  let value = String(text || '').trim();
  const wrapped = /^[$#]\{([\s\S]*)\}$/.exec(value);
  if (wrapped) value = wrapped[1].trim();
  let match = /^([A-Za-z_][\w.]*(?:\[\d+\])*)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/.exec(value);
  if (match) return { left: match[1], op: OPS[match[2]], right: unquote(match[3]) };
  match = /^([A-Za-z_][\w.]*)\s+contains\s+(.+)$/i.exec(value);
  if (match) return { left: match[1], op: 'contains', right: unquote(match[2]) };
  match = /^(!)?\s*([A-Za-z_][\w.]*)$/.exec(value);
  if (match) return { left: match[2], op: match[1] ? 'empty' : 'not_empty', right: '' };
  return null;
}
function unquote(text) {
  const value = String(text).trim();
  return /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
}
const SYMBOL = { eq: '==', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };
export function conditionText(condition) {
  if (!condition?.left) return '';
  if (condition.op === 'empty') return `\${!${condition.left}}`;
  if (condition.op === 'not_empty') return `\${${condition.left}}`;
  if (condition.op === 'contains') return `\${${condition.left} contains '${condition.right ?? ''}'}`;
  const right = String(condition.right ?? '');
  return `\${${condition.left} ${SYMBOL[condition.op] || '=='} ${/^-?\d+(\.\d+)?$/.test(right) ? right : `'${right.replace(/'/g, '')}'`}}`;
}

/** "Manager approval" -> "managerApproval". */
export function varName(text, fallback = 'result') {
  const words = String(text || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const name = words.map((word, index) => (index ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase())).join('');
  const out = /^[A-Za-z]/.test(name) ? name.slice(0, 60) : `${fallback}${name}`.slice(0, 60);
  return NAME.test(out) ? out : fallback;
}

function jsonAttr(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return Symbol.for('invalid'); }
}

const LABELS = {
  task: 'Task', userTask: 'User task', manualTask: 'Manual task', serviceTask: 'Service task', sendTask: 'Send task', receiveTask: 'Receive task',
  scriptTask: 'Script task', businessRuleTask: 'Business rule task', callActivity: 'Call activity', subProcess: 'Subprocess', transaction: 'Transaction',
  adHocSubProcess: 'Ad-hoc subprocess', startEvent: 'Start event', endEvent: 'End event', intermediateCatchEvent: 'Intermediate event',
  intermediateThrowEvent: 'Intermediate throw event', boundaryEvent: 'Boundary event', exclusiveGateway: 'Exclusive gateway',
  parallelGateway: 'Parallel gateway', inclusiveGateway: 'Inclusive gateway', eventBasedGateway: 'Event-based gateway', complexGateway: 'Complex gateway',
};
export const elementLabel = (local) => LABELS[local] || local;
const IGNORED = new Set(['textAnnotation', 'association', 'group', 'dataObject', 'dataObjectReference', 'dataStoreReference', 'dataInputAssociation', 'dataOutputAssociation', 'laneSet', 'documentation', 'extensionElements', 'ioSpecification', 'property']);
const FLOW_NODES = new Set(Object.keys(LABELS));
const EVENT_DEFS = ['timerEventDefinition', 'messageEventDefinition', 'signalEventDefinition', 'errorEventDefinition', 'escalationEventDefinition',
  'compensateEventDefinition', 'conditionalEventDefinition', 'linkEventDefinition', 'terminateEventDefinition', 'cancelEventDefinition'];
const eventKind = (element) => {
  const defs = EVENT_DEFS.filter((local) => kid(element, local));
  if (defs.length > 1) return 'multiple';
  return defs[0] ? defs[0].replace('EventDefinition', '') : 'none';
};

// ---- Compile ---------------------------------------------------------------------------------

/**
 * Compiles BPMN XML. Returns { definition, errors, warnings, elements, process, trigger } where
 * errors/warnings are [{ elementId?, message }] and `definition` is a Flow definition whose nodes
 * carry config.bpmnId (and edges bpmnId) so run state maps back to the diagram.
 */
export function compileBpmn(xml) {
  const errors = [];
  const warnings = [];
  const add = (list, message, elementId) => list.push(elementId ? { elementId, message } : { message });
  let root;
  try { root = parseXml(xml); } catch (error) {
    return { definition: null, errors: [{ message: `The file is not valid BPMN XML: ${error.message}` }], warnings, elements: [], process: null, trigger: null };
  }
  if (root.local !== 'definitions' || root.ns !== BPMN_NS) {
    return { definition: null, errors: [{ message: 'The file is not a BPMN 2.0 document (expected bpmn:definitions)' }], warnings, elements: [], process: null, trigger: null };
  }
  const processes = kids(root, 'process');
  const hasNodes = (proc) => proc.children.some((child) => child.ns === BPMN_NS && FLOW_NODES.has(child.local));
  const executable = processes.filter(hasNodes);
  const collaboration = kid(root, 'collaboration');
  const participants = collaboration ? kids(collaboration, 'participant') : [];
  if (!executable.length) {
    return { definition: null, errors: [{ message: 'Add a start event, the steps, and an end event to the diagram' }], warnings, elements: [], process: processes[0] ? { id: processes[0].attrs.id, name: processes[0].attrs.name || '' } : null, trigger: null };
  }
  if (executable.length > 1) {
    for (const proc of executable.slice(1)) {
      const pool = participants.find((item) => item.attrs.processRef === proc.attrs.id);
      add(errors, `Only one pool can contain the process. Move these steps into ${participantName(participants, executable[0])} or leave this pool empty (a black-box pool)`, pool?.attrs.id || proc.attrs.id);
    }
  }
  if (collaboration && kids(collaboration, 'messageFlow').length) add(warnings, 'Message flows between pools are documentation only. Use a message start event to start the process from another system (webhook).');
  const proc = executable[0];

  // Diagram positions for compiled nodes.
  const bounds = new Map();
  for (const diagram of kids(root, 'BPMNDiagram', BPMNDI_NS)) {
    const stackDi = [...diagram.children];
    while (stackDi.length) {
      const item = stackDi.pop();
      if (item.local === 'BPMNShape' && item.ns === BPMNDI_NS) {
        const b = kid(item, 'Bounds', DC_NS);
        if (b) bounds.set(item.attrs.bpmnElement, { x: Number(b.attrs.x) || 0, y: Number(b.attrs.y) || 0 });
      }
      stackDi.push(...item.children);
    }
  }

  // Lanes: element id -> lane.
  const laneOf = new Map();
  const lanes = [];
  const readLanes = (laneSet, parentLane) => {
    for (const lane of kids(laneSet, 'lane')) {
      const info = { id: lane.attrs.id, name: lane.attrs.name || '', role: urap(lane, 'role') || (parentLane?.role ?? ''), assigneeUserId: urap(lane, 'assigneeUserId') || (parentLane?.assigneeUserId ?? '') };
      if (info.role && !LANE_ROLES.includes(info.role)) add(errors, `Lane ${info.name || info.id}: unknown role ${info.role}`, info.id);
      lanes.push(info);
      for (const ref of kids(lane, 'flowNodeRef')) laneOf.set(ref.text.trim(), info);
      for (const child of kids(lane, 'childLaneSet')) readLanes(child, info);
    }
  };
  for (const laneSet of kids(proc, 'laneSet')) readLanes(laneSet, null);

  const nodes = new Map();
  const edges = [];
  const elements = [];
  const passThrough = new Set();
  const splitOf = new Map(); // combined join+split gateway id -> its split node id
  const parentOf = new Map();
  const usedVars = new Set();
  let start = null;
  let trigger = { type: 'manual' };
  const node = (id, type, name, config = {}, bpmnId = id) => {
    const position = bounds.get(bpmnId) || { x: 0, y: 0 };
    const entry = { id, type, name: name || '', x: position.x, y: position.y, config: { ...config, bpmnId } };
    if (parentOf.has(bpmnId)) entry.config.bpmnParent = parentOf.get(bpmnId);
    nodes.set(id, entry);
    return entry;
  };
  const outputVarFor = (element, fallback) => {
    const explicit = urap(element, 'outputVar');
    if (explicit !== undefined) {
      if (explicit && !NAME.test(explicit)) add(errors, `${element.attrs.name || element.attrs.id}: the result variable must start with a letter and use letters, digits, or _`, element.attrs.id);
      if (explicit) usedVars.add(explicit);
      return explicit || undefined;
    }
    let name = varName(element.attrs.name, fallback);
    let n = 2;
    while (usedVars.has(name)) { name = `${varName(element.attrs.name, fallback)}${n}`; n += 1; }
    usedVars.add(name);
    return name;
  };

  const walk = (container, depth) => {
    const flows = kids(container, 'sequenceFlow');
    for (const element of container.children) {
      if (element.ns !== BPMN_NS) continue;
      const { local } = element;
      const id = element.attrs.id;
      const name = (element.attrs.name || '').trim();
      if (local === 'sequenceFlow' || IGNORED.has(local)) continue;
      if (!FLOW_NODES.has(local)) { add(warnings, `${local} is not executed and was ignored`, id); continue; }
      if (!id || !ID.test(id)) { add(errors, `A ${elementLabel(local)} needs an id of letters, digits, - or _ (found "${id || ''}")`, id); continue; }
      if (depth > 0) parentOf.set(id, container.attrs.id);
      elements.push({ id, type: local, name, lane: laneOf.get(id)?.name || null });
      const label = name || elementLabel(local);
      const unsupported = (why) => add(errors, `${label}: ${why}`, id);
      switch (local) {
        case 'startEvent': {
          const kind = eventKind(element);
          if (depth > 0) {
            if (kind !== 'none') unsupported('a subprocess start event must be a plain (none) start event');
            node(id, 'start', name); passThrough.add(id);
            break;
          }
          if (element.attrs.isInterrupting === 'false') unsupported('non-interrupting start events are not supported');
          if (start) { unsupported('a process can have only one start event'); break; }
          start = id;
          const config = { trigger: 'manual' };
          if (kind === 'timer') {
            const def = kid(element, 'timerEventDefinition');
            const cycle = kid(def, 'timeCycle')?.text.trim();
            const cron = cycle ? cycleToCron(cycle) : null;
            if (!cycle) unsupported(kid(def, 'timeDate') || kid(def, 'timeDuration') ? 'a timer start needs a repeating time cycle (a cron expression like "0 9 * * 1-5" or R/PT1H); one-off dates are not supported' : 'set the timer cycle (a cron expression like "0 9 * * 1-5" or R/PT1H)');
            else if (!cron) unsupported(`cannot schedule "${cycle}". Use a cron expression or a repeat of minutes, hours, a day, or a week (R/PT15M, R/PT2H, R/P1D)`);
            config.trigger = 'schedule';
            config.cron = cron || '';
            config.timezone = urap(element, 'timezone') || 'UTC';
            trigger = { type: 'schedule', cron, timezone: config.timezone };
          } else if (kind === 'message') {
            config.trigger = 'webhook';
            trigger = { type: 'webhook' };
          } else if (kind !== 'none') unsupported(`${kind} start events are not supported. Use a none, timer, or message start event`);
          node(id, 'start', name || 'Start', config);
          break;
        }
        case 'endEvent': {
          const kind = eventKind(element);
          if (depth > 0) {
            if (!['none', 'message'].includes(kind)) unsupported(`${kind} end events are not supported inside a subprocess`);
            node(id, 'end', name); passThrough.add(id);
            break;
          }
          if (kind === 'message') add(warnings, `${label}: the message is not sent; the run simply ends here`, id);
          else if (kind !== 'none') unsupported(`${kind} end events are not supported. Use a none or message end event`);
          node(id, 'end', name || 'End');
          break;
        }
        case 'intermediateCatchEvent': {
          const kind = eventKind(element);
          if (kind !== 'timer') { unsupported(`${kind === 'none' ? 'plain' : kind} intermediate catch events are not supported. Use a timer`); break; }
          const def = kid(element, 'timerEventDefinition');
          const duration = kid(def, 'timeDuration')?.text.trim();
          const seconds = duration ? isoDurationSeconds(duration) : null;
          if (!duration) unsupported(kid(def, 'timeDate') || kid(def, 'timeCycle') ? 'an intermediate timer waits for a duration (like PT10M); dates and cycles are not supported' : 'set how long to wait (a duration like PT10M or P1D)');
          else if (!seconds || seconds < 1 || seconds > MAX_TIMER_SECONDS) unsupported(`"${duration}" must be a duration between 1 second and 30 days (like PT10M)`);
          node(id, 'timer', name || 'Wait', { seconds: seconds || 0 });
          break;
        }
        case 'userTask':
        case 'manualTask': {
          const lane = laneOf.get(id);
          const formFields = jsonAttr(urap(element, 'formFields'), []);
          if (formFields === Symbol.for('invalid') || !Array.isArray(formFields)) unsupported('the form fields are not valid JSON');
          const dueInHours = urap(element, 'dueInHours');
          node(id, 'human', name, {
            title: urap(element, 'title') || name || 'Review required',
            description: urap(element, 'description') || (lane?.name ? `Lane: ${lane.name}` : ''),
            taskType: urap(element, 'taskType') || (Array.isArray(formFields) && formFields.length ? 'form' : 'approval'),
            priority: urap(element, 'priority') || 'medium',
            assignedRole: urap(element, 'assignedRole') || (urap(element, 'assigneeUserId') ? '' : lane?.role || ''),
            assigneeUserId: urap(element, 'assigneeUserId') || (urap(element, 'assignedRole') ? '' : lane?.assigneeUserId || ''),
            formFields: Array.isArray(formFields) ? formFields : [],
            ...(dueInHours ? { dueInHours: Number(dueInHours) } : {}),
            outputVar: outputVarFor(element, 'task'),
            lane: lane?.name || '',
          });
          break;
        }
        case 'serviceTask': {
          const kind = urap(element, 'serviceType') || 'workflow';
          if (!SERVICE_KINDS.includes(kind)) { unsupported(`unknown service type ${kind}`); break; }
          const input = jsonAttr(urap(element, 'input'), {});
          const validInput = input !== Symbol.for('invalid') && input && typeof input === 'object' && !Array.isArray(input);
          if (!validInput) unsupported('the input mapping is not a valid JSON object');
          const retries = Number(urap(element, 'retries') || 0);
          const common = { input: validInput ? input : {}, retries, outputVar: outputVarFor(element, 'result') };
          if (kind === 'workflow') node(id, 'robot', name, { ...common, workflowId: urap(element, 'workflowId') || '' });
          if (kind === 'agent') node(id, 'agent', name, { ...common, agentId: urap(element, 'agentId') || '' });
          if (kind === 'http') {
            const body = urap(element, 'requestBody');
            node(id, 'http', name, { connectionId: urap(element, 'connectionId') || '', method: urap(element, 'httpMethod') || 'GET', path: urap(element, 'path') || '', ...(body ? { body } : {}), retries, outputVar: common.outputVar });
          }
          if (kind === 'case') {
            node(id, 'case', name, { caseTypeId: urap(element, 'caseTypeId') || '', title: urap(element, 'title') || '', fields: validInput ? input : {}, priority: urap(element, 'priority') || '', waitForResolution: urap(element, 'waitForResolution') === 'true', outputVar: common.outputVar });
          }
          break;
        }
        case 'task':
          unsupported('choose what the task does: change it to a User task (a person in Action Center) or a Service task (robot, agent, API call, or case) with the wrench menu');
          break;
        case 'exclusiveGateway':
        case 'parallelGateway': {
          const ins = flows.filter((flow) => flow.attrs.targetRef === id).length;
          const outs = flows.filter((flow) => flow.attrs.sourceRef === id).length;
          if (local === 'exclusiveGateway') {
            if (outs >= 2) node(id, 'decision', name || 'Decision');
            else { node(id, 'decision', name); passThrough.add(id); }
          } else if (outs >= 2 && ins >= 2) {
            node(id, 'join', name || 'Join');
            node(`${id}__split`, 'parallel', name || 'Split', {}, id);
            splitOf.set(id, `${id}__split`);
            edges.push({ id: `${id}__e`, from: id, to: `${id}__split`, bpmnId: id });
          } else if (outs >= 2) node(id, 'parallel', name || 'Split');
          else if (ins >= 2) node(id, 'join', name || 'Join');
          else { node(id, 'parallel', name); passThrough.add(id); }
          break;
        }
        case 'subProcess': {
          if (element.attrs.triggeredByEvent === 'true') { unsupported('event subprocesses are not supported'); break; }
          const inner = element.children.filter((child) => child.ns === BPMN_NS && FLOW_NODES.has(child.local));
          const starts = inner.filter((child) => child.local === 'startEvent');
          const ends = inner.filter((child) => child.local === 'endEvent');
          if (starts.length !== 1) { unsupported('a subprocess needs exactly one start event'); break; }
          if (!ends.length) { unsupported('a subprocess needs an end event'); break; }
          if (ends.length > 1 && inner.some((child) => child.local === 'parallelGateway')) unsupported('a subprocess with parallel branches must join them before a single end event');
          // Flows into the subprocess enter at its start; its end events leave through `${id}__out`.
          node(`${id}__in`, 'start', name, {}, id); passThrough.add(`${id}__in`);
          edges.push({ id: `${id}__ein`, from: `${id}__in`, to: starts[0].attrs.id, bpmnId: id });
          node(`${id}__out`, 'end', name, {}, id); passThrough.add(`${id}__out`);
          for (const end of ends) edges.push({ id: `${end.attrs.id}__eout`, from: end.attrs.id, to: `${id}__out`, bpmnId: id });
          walk(element, depth + 1);
          break;
        }
        case 'boundaryEvent':
          unsupported('boundary events are not supported. Model the timeout or error path with a gateway after the task');
          break;
        case 'eventBasedGateway':
          unsupported('event-based gateways are not supported. Use an exclusive gateway with conditions');
          break;
        case 'inclusiveGateway':
          unsupported('inclusive gateways are not supported. Use an exclusive gateway, or a parallel gateway when every branch runs');
          break;
        case 'intermediateThrowEvent':
          unsupported('intermediate throw events are not supported. Remove it or use a timer catch event');
          break;
        default:
          unsupported(`${elementLabel(local)}s are not supported. Use a User task or a Service task`);
      }
    }
    for (const flow of flows) {
      const { id, sourceRef, targetRef } = flow.attrs;
      if (!id || !ID.test(id)) { add(errors, 'A sequence flow needs an id of letters, digits, - or _', id); continue; }
      const sourceElement = container.children.find((child) => child.attrs?.id === sourceRef);
      let condition = null;
      const left = urap(flow, 'conditionLeft');
      if (left) condition = { left, op: urap(flow, 'conditionOp') || 'eq', right: urap(flow, 'conditionRight') ?? '' };
      else {
        const expression = kid(flow, 'conditionExpression');
        if (expression && expression.text.trim()) {
          condition = parseConditionExpression(expression.text);
          if (!condition) add(errors, `Condition "${expression.text.trim()}" is not understood. Write it like \${vars.review.outcome == 'approve'}`, id);
        }
      }
      const isDefault = sourceElement?.attrs.default === id;
      const edge = { id, from: sourceElement?.local === 'subProcess' ? `${sourceRef}__out` : (splitOf.get(sourceRef) || sourceRef), to: container.children.find((child) => child.attrs?.id === targetRef)?.local === 'subProcess' ? `${targetRef}__in` : targetRef, bpmnId: id };
      if (flow.attrs.name) edge.label = flow.attrs.name.slice(0, 80);
      if (sourceElement?.local === 'exclusiveGateway') {
        if (isDefault) edge.isDefault = true;
        else if (condition) edge.condition = condition;
      } else if (condition && sourceElement) add(warnings, `The condition on the flow after ${sourceElement.attrs.name || elementLabel(sourceElement.local)} is ignored. Conditions only apply after an exclusive gateway`, id);
      edges.push(edge);
    }
  };
  walk(proc, 0);
  if (!start) add(errors, 'Add a start event');

  // Remove pass-through nodes (merge-only gateways, subprocess boundaries) by rewiring.
  for (const id of passThrough) {
    const outs = edges.filter((edge) => edge.from === id);
    const ins = edges.filter((edge) => edge.to === id);
    const bpmnId = nodes.get(id)?.config.bpmnId || id;
    if (outs.length !== 1) {
      if (!errors.some((item) => item.elementId === bpmnId)) add(errors, `${nodes.get(id)?.name || elementLabel('exclusiveGateway')}: needs exactly one outgoing sequence flow`, bpmnId);
      continue;
    }
    for (const edge of ins) {
      edge.to = outs[0].to;
      if (!edge.label && outs[0].label) edge.label = outs[0].label;
      // Remember the removed elements so a run can still light them up on the diagram.
      edge.via = [...new Set([...(edge.via || []), bpmnId, outs[0].bpmnId, ...(outs[0].via || [])])];
    }
    edges.splice(edges.indexOf(outs[0]), 1);
    nodes.delete(id);
  }
  // Pass-through-to-pass-through chains resolve because each rewire uses the current outgoing edge.

  if (start && nodes.get(start)) {
    const outs = edges.filter((edge) => edge.from === start);
    if (outs.length > 1) add(errors, 'The start event can have only one outgoing flow. Add a parallel gateway to start several branches', start);
  }
  for (const entry of nodes.values()) {
    if (['robot', 'agent', 'human', 'http', 'case', 'timer'].includes(entry.type)) {
      const outs = edges.filter((edge) => edge.from === entry.id);
      if (outs.length > 1) add(errors, `${entry.name || 'This step'} has ${outs.length} outgoing flows. Add a gateway to choose (exclusive) or run them all (parallel)`, entry.config.bpmnId);
    }
  }
  const validEdges = edges.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to));
  const flagged = new Set(errors.map((item) => item.elementId).filter(Boolean));
  for (const edge of edges) {
    // A flow into or out of an element that already has an error is not reported again.
    if (!validEdges.includes(edge) && !flagged.has(edge.bpmnId) && !flagged.has(edge.from) && !flagged.has(edge.to)) add(errors, 'This sequence flow is connected to an unsupported or missing element', edge.bpmnId);
  }
  const definition = {
    nodes: [...nodes.values()],
    edges: validEdges,
    variables: [],
    bpmn: { processId: proc.attrs.id, lanes: lanes.map(({ id, name, role }) => ({ id, name, role })) },
  };
  return { definition, errors, warnings, elements, process: { id: proc.attrs.id, name: proc.attrs.name || participantName(participants, proc) || '' }, trigger };
}

function participantName(participants, proc) {
  return participants.find((item) => item.attrs.processRef === proc.attrs.id)?.attrs.name || proc.attrs.name || 'the main pool';
}

/** Maps Flow validation issues ({ nodeId, edgeId }) onto BPMN element ids. */
export function mapFlowIssues(issues, definition) {
  const nodes = new Map((definition?.nodes || []).map((item) => [item.id, item]));
  const edges = new Map((definition?.edges || []).map((item) => [item.id, item]));
  return (issues || []).map((issue) => {
    const elementId = (issue.edgeId && edges.get(issue.edgeId)?.bpmnId) || (issue.nodeId && (nodes.get(issue.nodeId)?.config?.bpmnId || issue.nodeId)) || undefined;
    return elementId ? { elementId, message: issue.message } : { message: issue.message };
  });
}

/**
 * Run state per BPMN element from flow run nodes: { elements: { id: 'active'|'done'|'failed'|'cancelled' } }.
 * Sequence flows (and merge gateways that compiled away) a run went through are included as 'done'.
 */
export function elementStates(definition, runNodes) {
  const byNode = new Map();
  const rank = { SUCCEEDED: 1, CANCELLED: 2, WAITING: 3, READY: 3, FAILED: 4 };
  for (const row of runNodes || []) {
    const current = byNode.get(row.nodeId);
    if (!current || (rank[row.status] || 0) >= (rank[current] || 0)) byNode.set(row.nodeId, row.status);
  }
  const word = { WAITING: 'active', READY: 'active', SUCCEEDED: 'done', FAILED: 'failed', CANCELLED: 'cancelled' };
  const order = { done: 1, cancelled: 2, active: 3, failed: 4 };
  const elements = {};
  const put = (id, state) => { if (id && state && (!elements[id] || order[state] > order[elements[id]])) elements[id] = state; };
  for (const item of definition?.nodes || []) {
    const status = byNode.get(item.id);
    if (!status) continue;
    put(item.config?.bpmnId || item.id, word[status]);
    if (item.config?.bpmnParent) put(item.config.bpmnParent, word[status]);
  }
  for (const edge of definition?.edges || []) {
    if (byNode.get(edge.from) !== 'SUCCEEDED' || !byNode.has(edge.to)) continue;
    const from = (definition.nodes || []).find((item) => item.id === edge.from);
    if (edge.bpmnId && edge.bpmnId !== from?.config?.bpmnId) put(edge.bpmnId, 'done');
    for (const id of edge.via || []) put(id, 'done');
  }
  return { elements };
}
