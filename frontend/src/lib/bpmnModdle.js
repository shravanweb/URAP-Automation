// The urap: extension attributes for bpmn-js (moddle). They hold the URAP settings of each element
// (what a service task runs, who a user task goes to, branch conditions) and stay in the .bpmn file,
// so an exported diagram re-imports with its settings. Other tools simply ignore them.
import { URAP_NS } from './bpmnCompile.js';

export const URAP_ATTRIBUTES = [
  // Service tasks
  'serviceType', 'workflowId', 'agentId', 'connectionId', 'caseTypeId', 'httpMethod', 'path', 'requestBody', 'input', 'retries', 'outputVar', 'waitForResolution',
  // User tasks
  'title', 'description', 'taskType', 'priority', 'assignedRole', 'assigneeUserId', 'formFields', 'dueInHours',
  // Lanes, timer start, sequence flows
  'role', 'timezone', 'conditionLeft', 'conditionOp', 'conditionRight',
];

export const URAP_MODDLE = {
  name: 'URAP',
  uri: URAP_NS,
  prefix: 'urap',
  xml: { tagAlias: 'lowerCase' },
  types: [{
    name: 'UrapSettings',
    extends: ['bpmn:BaseElement'],
    properties: URAP_ATTRIBUTES.map((name) => ({ name, isAttr: true, type: 'String' })),
  }],
};
