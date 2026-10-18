import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import AppLayout from './layouts/AppLayout.jsx';
import CloudLayout from './layouts/CloudLayout.jsx';
import { currentUser } from './services/api.js';
import LoginPage from './pages/auth/LoginPage.jsx';
import SignupPage from './pages/auth/SignupPage.jsx';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage.jsx';
import LegalPage from './pages/LegalPage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import HomePage from './pages/HomePage.jsx';
import StudioPage from './pages/StudioPage.jsx';
import FlowEditorPage from './pages/FlowEditorPage.jsx';
import FlowRunPage from './pages/FlowRunPage.jsx';
import AgentBuilderPage from './pages/AgentBuilderPage.jsx';
import AgentRunPage from './pages/AgentRunPage.jsx';
import AppDesignerPage from './pages/AppDesignerPage.jsx';
import AppRuntimePage from './pages/AppRuntimePage.jsx';
import AppsPage from './pages/AppsPage.jsx';
import CaseTypeDesignerPage from './pages/CaseTypeDesignerPage.jsx';
import BpmnModelerPage from './pages/BpmnModelerPage.jsx';
import BpmnRunPage from './pages/BpmnRunPage.jsx';
import CasesPage from './pages/CasesPage.jsx';
import CaseDetailPage from './pages/CaseDetailPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import WorkflowsPage from './pages/WorkflowsPage.jsx';
import OperationsPage from './pages/OperationsPage.jsx';
import QueuesPage from './pages/QueuesPage.jsx';
import ActionCenterPage from './pages/ActionCenterPage.jsx';

function RequireAuth() {
  const location = useLocation();
  if (!currentUser()) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return <Outlet />;
}

// Signed-in users who open /login or /signup go straight to the platform.
function PublicOnly({ children }) {
  return currentUser() ? <Navigate to="/dashboard" replace /> : children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/signup" element={<PublicOnly><SignupPage /></PublicOnly>} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/legal" element={<LegalPage />} />
      <Route element={<RequireAuth />}>
        {/* Signed-in home: light Automation Cloud shell with an app launcher for every page. */}
        <Route element={<CloudLayout />}>
          <Route path="/dashboard" element={<HomePage />} />
          <Route path="/studio" element={<StudioPage />} />
          <Route path="/studio/flows/:id" element={<FlowEditorPage />} />
          <Route path="/studio/flows/:id/runs/:runId" element={<FlowRunPage />} />
          <Route path="/studio/agents/:id" element={<AgentBuilderPage />} />
          <Route path="/studio/agents/:id/runs/:runId" element={<AgentRunPage />} />
          <Route path="/studio/apps/:id" element={<AppDesignerPage />} />
          <Route path="/apps" element={<AppsPage />} />
          <Route path="/studio/cases/:id" element={<CaseTypeDesignerPage />} />
          <Route path="/studio/processes/:id" element={<BpmnModelerPage />} />
          <Route path="/studio/processes/:id/runs/:runId" element={<BpmnRunPage />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/cases/:id" element={<CaseDetailPage />} />
          <Route path="/workflows/new" element={<WorkflowsPage mode="builder" />} />
          <Route path="/workflows/:id" element={<WorkflowsPage mode="builder" />} />
        </Route>
        <Route path="/apps/:id" element={<AppRuntimePage />} />
        <Route element={<AppLayout />}>
          <Route path="/metrics" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/workflows" element={<WorkflowsPage mode="library" />} />
          <Route path="/connections" element={<OperationsPage section="connections" />} />
          <Route path="/jobs" element={<OperationsPage section="jobs" />} />
          <Route path="/jobs/:id" element={<OperationsPage section="job" />} />
          <Route path="/schedules" element={<OperationsPage section="schedules" />} />
          <Route path="/queues" element={<QueuesPage />} />
          <Route path="/tasks" element={<ActionCenterPage />} />
          <Route path="/tasks/:id" element={<ActionCenterPage />} />
          <Route path="/reports" element={<OperationsPage section="reports" />} />
          <Route path="/audit" element={<OperationsPage section="audit" />} />
          <Route path="/settings" element={<OperationsPage section="settings" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
