// Starter BPMN diagrams for new processes.

const HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:urap="http://urap.dev/schema/bpmn/1.0" id="Definitions_1" targetNamespace="http://urap.dev/bpmn" exporter="URAP" exporterVersion="1.0">`;

const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A start event connected to an end event. */
export function blankProcessXml(name = 'Process') {
  return `${HEADER}
  <bpmn:process id="Process_1" name="${escape(name)}" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Start">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:endEvent id="EndEvent_1" name="Done">
      <bpmn:incoming>Flow_1</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="EndEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="182" y="162" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="188" y="205" width="25" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1">
        <dc:Bounds x="432" y="162" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="437" y="205" width="27" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="218" y="180" />
        <di:waypoint x="432" y="180" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

/**
 * Purchase request: Requester lane starts, a Manager lane approval (project managers), an
 * exclusive gateway, and a procurement robot (service task -> workflow) that places the order.
 */
export function purchaseRequestXml({ name = 'Purchase request', workflowId = '' } = {}) {
  const input = escape(JSON.stringify({ item: '{{vars.item}}', amount: '{{vars.amount}}' }));
  return `${HEADER}
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_1" name="${escape(name)}" processRef="Process_1" />
    <bpmn:textAnnotation id="Annotation_1">
      <bpmn:text>Managers approve in Action Center; the robot raises the PO</bpmn:text>
    </bpmn:textAnnotation>
    <bpmn:association id="Association_1" sourceRef="Task_Approve" targetRef="Annotation_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" name="${escape(name)}" isExecutable="true">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Requester" name="Requester">
        <bpmn:flowNodeRef>Start_Request</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Rejected</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Manager" name="Manager" urap:role="project_manager">
        <bpmn:flowNodeRef>Task_Approve</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gateway_Approved</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Procurement" name="Procurement robot">
        <bpmn:flowNodeRef>Task_CreatePO</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Ordered</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_Request" name="Purchase requested">
      <bpmn:outgoing>Flow_ToApprove</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_Approve" name="Approve purchase" urap:title="Approve purchase: {{vars.item}} ({{vars.amount}})" urap:taskType="approval" urap:outputVar="approval">
      <bpmn:incoming>Flow_ToApprove</bpmn:incoming>
      <bpmn:outgoing>Flow_ToGateway</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gateway_Approved" name="Approved?" default="Flow_Rejected">
      <bpmn:incoming>Flow_ToGateway</bpmn:incoming>
      <bpmn:outgoing>Flow_Approved</bpmn:outgoing>
      <bpmn:outgoing>Flow_Rejected</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:serviceTask id="Task_CreatePO" name="Create purchase order" urap:serviceType="workflow" urap:workflowId="${escape(workflowId)}" urap:input="${input}" urap:outputVar="order">
      <bpmn:incoming>Flow_Approved</bpmn:incoming>
      <bpmn:outgoing>Flow_ToOrdered</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:endEvent id="End_Ordered" name="Order placed">
      <bpmn:incoming>Flow_ToOrdered</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="End_Rejected" name="Request rejected">
      <bpmn:incoming>Flow_Rejected</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_ToApprove" sourceRef="Start_Request" targetRef="Task_Approve" />
    <bpmn:sequenceFlow id="Flow_ToGateway" sourceRef="Task_Approve" targetRef="Gateway_Approved" />
    <bpmn:sequenceFlow id="Flow_Approved" name="Approved" sourceRef="Gateway_Approved" targetRef="Task_CreatePO" urap:conditionLeft="vars.approval.outcome" urap:conditionOp="eq" urap:conditionRight="approve">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${vars.approval.outcome == 'approve'}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_Rejected" name="Rejected" sourceRef="Gateway_Approved" targetRef="End_Rejected" />
    <bpmn:sequenceFlow id="Flow_ToOrdered" sourceRef="Task_CreatePO" targetRef="End_Ordered" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1">
      <bpmndi:BPMNShape id="Participant_1_di" bpmnElement="Participant_1" isHorizontal="true">
        <dc:Bounds x="130" y="60" width="900" height="420" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Requester_di" bpmnElement="Lane_Requester" isHorizontal="true">
        <dc:Bounds x="160" y="60" width="870" height="140" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Manager_di" bpmnElement="Lane_Manager" isHorizontal="true">
        <dc:Bounds x="160" y="200" width="870" height="140" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Procurement_di" bpmnElement="Lane_Procurement" isHorizontal="true">
        <dc:Bounds x="160" y="340" width="870" height="140" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Start_Request_di" bpmnElement="Start_Request">
        <dc:Bounds x="222" y="112" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="193" y="155" width="94" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_Approve_di" bpmnElement="Task_Approve">
        <dc:Bounds x="310" y="230" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_Approved_di" bpmnElement="Gateway_Approved" isMarkerVisible="true">
        <dc:Bounds x="475" y="245" width="50" height="50" />
        <bpmndi:BPMNLabel><dc:Bounds x="535" y="263" width="52" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_CreatePO_di" bpmnElement="Task_CreatePO">
        <dc:Bounds x="600" y="370" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Ordered_di" bpmnElement="End_Ordered">
        <dc:Bounds x="802" y="392" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="788" y="435" width="64" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_Rejected_di" bpmnElement="End_Rejected">
        <dc:Bounds x="802" y="112" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="777" y="155" width="86" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Annotation_1_di" bpmnElement="Annotation_1">
        <dc:Bounds x="600" y="215" width="220" height="40" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_ToApprove_di" bpmnElement="Flow_ToApprove">
        <di:waypoint x="258" y="130" />
        <di:waypoint x="360" y="130" />
        <di:waypoint x="360" y="230" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_ToGateway_di" bpmnElement="Flow_ToGateway">
        <di:waypoint x="410" y="270" />
        <di:waypoint x="475" y="270" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Approved_di" bpmnElement="Flow_Approved">
        <di:waypoint x="500" y="295" />
        <di:waypoint x="500" y="410" />
        <di:waypoint x="600" y="410" />
        <bpmndi:BPMNLabel><dc:Bounds x="508" y="383" width="48" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Rejected_di" bpmnElement="Flow_Rejected">
        <di:waypoint x="500" y="245" />
        <di:waypoint x="500" y="130" />
        <di:waypoint x="802" y="130" />
        <bpmndi:BPMNLabel><dc:Bounds x="508" y="183" width="47" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_ToOrdered_di" bpmnElement="Flow_ToOrdered">
        <di:waypoint x="700" y="410" />
        <di:waypoint x="802" y="410" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Association_1_di" bpmnElement="Association_1">
        <di:waypoint x="410" y="255" />
        <di:waypoint x="600" y="236" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}
