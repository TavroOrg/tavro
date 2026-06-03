import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { isAccessTokenExpired, isAccessTokenHardExpired, refreshAccessToken, clearAuth } from './services/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import HomePage from './pages/HomePage';
import Dashboard from './pages/Dashboard';
import CreateAgentPage from './pages/CreateAgentPage';
import AgentViewPage from './pages/AgentViewPage';
import InsightsPage from './pages/InsightsPage';
import InsightsPageMock from './pages/InsightsPageMock';
import Settings from './pages/Settings';
import AuthCallback from './pages/AuthCallback';
import UseCasePage from './pages/UseCasePage';
import UseCaseViewPage from './pages/UseCaseViewPage';
import CreateUseCasePage from './pages/CreateUseCasePage';
import { CatalogProvider } from './context/CatalogContext';
import { UseCaseProvider } from './context/UseCaseContext';
import { ChatProvider } from './context/ChatContext';
import { ChatSessionProvider } from './context/ChatSessionContext';
import { ThemeProvider } from './context/ThemeContext';
import './App.css';
import BlueprintPage from './pages/BlueprintPage';
import BlueprintSetupPage from './pages/BlueprintSetupPage';
import { BlueprintProvider } from './context/BlueprintContext';
import PlaygroundPage from './pages/PlaygroundPage';
import { PlaygroundProvider } from './context/PlaygroundContext';
import CompliancePage from './pages/CompliancePage';
import ComplianceItemPage from './pages/ComplianceItemPage';
import ComplianceSetupPage from './pages/ComplianceSetupPage';
import { ComplianceProvider } from './context/ComplianceContext';

import AuditCenterPage from './pages/AuditCenterPage';
import AuditRunDetailPage from './pages/AuditRunDetailPage';
import BusinessApplicationsPage from './pages/BusinessApplicationsPage';
import BusinessApplicationViewPage from './pages/BusinessApplicationViewPage';
import BusinessProcessesPage from './pages/BusinessProcessesPage';
import BusinessProcessViewPage from './pages/BusinessProcessViewPage';
import IntegrationsPage from './pages/IntegrationsPage';
import IntegrationViewPage from './pages/IntegrationViewPage';
import SparkPage from './pages/SparkPage';
import UserGuidePage from './pages/UserGuidePage';
import ContainerLogsPage from './pages/ContainerLogsPage';

// ── Auth guard ────────────────────────────────────────────────────────────────

type AuthStatus = 'checking' | 'ok' | 'expired';

function useAuthCheck(): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>(() => {
    if (localStorage.getItem('tavro_auth') !== 'true') return 'expired';
    if (!isAccessTokenExpired()) return 'ok';
    return 'checking'; // token expired — try silent refresh
  });

  useEffect(() => {
    if (status !== 'checking') return;
    refreshAccessToken().then(ok => {
      if (ok) { setStatus('ok'); return; }
      // Refresh failed. Only force logout when the token is definitively expired
      // (past its actual exp claim). The 30-second pre-emptive window in
      // isAccessTokenExpired() can put valid tokens into 'checking'; if the
      // refresh fails for a transient reason (no refresh token stored yet,
      // network hiccup) we should NOT log the user out while their token is
      // still accepted by the server.
      setStatus(isAccessTokenHardExpired() ? 'expired' : 'ok');
    });
  }, [status]);

  // Re-run the check whenever session_expired fires from an API layer.
  useEffect(() => {
    const handler = () => setStatus('expired');
    window.addEventListener('tavro:session_expired', handler);
    return () => window.removeEventListener('tavro:session_expired', handler);
  }, []);

  return status;
}

const PrivateRoute = ({ children }: { children: JSX.Element }) => {
  const auth = useAuthCheck();
  if (auth === 'checking') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-blue-500" />
      </div>
    );
  }
  return auth === 'ok' ? children : <Navigate to="/login" replace />;
};

/**
 * Listens for 'tavro:session_expired' — dispatched by API clients when a
 * token refresh attempt fails. Clears auth state then soft-redirects to /login.
 */
function SessionExpiredHandler() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = () => {
      console.warn('[App] tavro:session_expired — clearing auth and navigating to /login');
      clearAuth();
      navigate('/login', { replace: true });
    };
    window.addEventListener('tavro:session_expired', handler);
    return () => window.removeEventListener('tavro:session_expired', handler);
  }, [navigate]);
  return null;
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ChatSessionProvider>
        <ChatProvider>
          <SessionExpiredHandler />
          <div className="App">
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/google/auth/callback" element={<AuthCallback />} />

              {/* Protected routes — Layout is the shell */}
              <Route
                path="/"
                element={
                  <PrivateRoute>
                    <CatalogProvider>
                      <UseCaseProvider>
                        <PlaygroundProvider>
                          <BlueprintProvider>
                            <ComplianceProvider>
                              <Layout />
                            </ComplianceProvider>
                          </BlueprintProvider>
                        </PlaygroundProvider>
                      </UseCaseProvider>
                    </CatalogProvider>
                  </PrivateRoute>
                }
              >
                <Route index element={<HomePage />} />
                <Route path="catalog" element={<Dashboard />} />
                <Route path="agents/new" element={<CreateAgentPage />} />
                <Route path="use-cases" element={<UseCasePage />} />
                <Route path="use-cases/new" element={<CreateUseCasePage />} />
                <Route path="use-case/:id" element={<UseCaseViewPage />} />
                <Route path="insights" element={<InsightsPageMock />} />
                <Route path="agent/:id" element={<AgentViewPage />} />
                <Route path="settings" element={<Settings />} />
                <Route path="settings/logs" element={<ContainerLogsPage />} />

                {/* ── Blueprint routes (ADD THESE) ── */}
                <Route path="blueprint" element={<BlueprintPage />} />
                <Route path="blueprint/setup" element={<BlueprintSetupPage />} />
                {/* ── Playground routes ── */}
                <Route path="playground" element={<PlaygroundPage />} />

                {/* ── Compliance routes (ADD THESE) ── */}
                <Route path="compliance" element={<CompliancePage />} />
                <Route path="compliance/new" element={<ComplianceSetupPage />} />
                <Route path="compliance/:id" element={<ComplianceItemPage />} />

                <Route path="audit" element={<AuditCenterPage />} />
                <Route path="audit/:runId" element={<AuditRunDetailPage />} />
                <Route path="applications" element={<BusinessApplicationsPage />} />
                <Route path="applications/new" element={<BusinessApplicationViewPage />} />
                <Route path="applications/:id" element={<BusinessApplicationViewPage />} />
                <Route path="processes" element={<BusinessProcessesPage />} />
                <Route path="processes/new" element={<BusinessProcessViewPage />} />
                <Route path="processes/:id" element={<BusinessProcessViewPage />} />
                <Route path="integrations" element={<IntegrationsPage />} />
                <Route path="integrations/new" element={<IntegrationViewPage />} />
                <Route path="integrations/:id" element={<IntegrationViewPage />} />

                <Route path="spark" element={<SparkPage />} />

              </Route>

              {/* Standalone — renders without the Layout shell */}
              <Route path="/help/user-guide" element={<UserGuidePage />} />
            </Routes>
          </div>
        </ChatProvider>
        </ChatSessionProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
