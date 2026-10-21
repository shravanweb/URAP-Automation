import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import AppLayout from './layouts/AppLayout.jsx';
import CloudLayout from './layouts/CloudLayout.jsx';
import { currentUser } from './services/api.js';
import { PageLoader, TopProgress } from './components/Loader.jsx';
import LoginPage from './pages/auth/LoginPage.jsx';
import SignupPage from './pages/auth/SignupPage.jsx';
import LandingPage from './pages/LandingPage.jsx';

// Signed-in pages load on demand; the landing and auth pages stay in the main bundle for a fast first paint.
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage.jsx'));
const LegalPage = lazy(() => import('./pages/LegalPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const HomePage = lazy(() => import('./pages/HomePage.jsx'));
const StudioPage = lazy(() => import('./pages/StudioPage.jsx'));
const FlowEditorPage = lazy(() => import('./pages/FlowEditorPage.jsx'));
const FlowRunPage = lazy(() => import('./pages/FlowRunPage.jsx'));
const AgentBuilderPage = lazy(() => import('./pages/AgentBuilderPage.jsx'));
const AgentRunPage = lazy(() => import('./pages/AgentRunPage.jsx'));
const AppDesignerPage = lazy(() => import('./pages/AppDesignerPage.jsx'));
const AppRuntimePage = lazy(() => import('./pages/AppRuntimePage.jsx'));
const AppsPage = lazy(() => import('./pages/AppsPage.jsx'));
const CaseTypeDesignerPage = lazy(() => import('./pages/CaseTypeDesignerPage.jsx'));
const BpmnModelerPage = lazy(() => import('./pages/BpmnModelerPage.jsx'));
const BpmnRunPage = lazy(() => import('./pages/BpmnRunPage.jsx'));
const CasesPage = lazy(() => import('./pages/CasesPage.jsx'));
const CaseDetailPage = lazy(() => import('./pages/CaseDetailPage.jsx'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage.jsx'));
const WorkflowsPage = lazy(() => import('./pages/WorkflowsPage.jsx'));
const OperationsPage = lazy(() => import('./pages/OperationsPage.jsx'));
const QueuesPage = lazy(() => import('./pages/QueuesPage.jsx'));
const ActionCenterPage = lazy(() => import('./pages/ActionCenterPage.jsx'));

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
    <>
    <TopProgress />
    <Suspense fallback={<PageLoader />}>
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
    </Suspense>
    </>
  );
}
