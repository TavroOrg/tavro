import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './components/Layout';
import Login from './pages/Login';
import HomePage from './pages/HomePage';
import Dashboard from './pages/Dashboard';
import CreateAgentPage from './pages/CreateAgentPage';
import AgentViewPage from './pages/AgentViewPage';
import InsightsPage from './pages/InsightsPage';
import Settings from './pages/Settings';
import AuthCallback from './pages/AuthCallback';
import UseCasePage from './pages/UseCasePage';
import UseCaseViewPage from './pages/UseCaseViewPage';
import CreateUseCasePage from './pages/CreateUseCasePage';
import { CatalogProvider } from './context/CatalogContext';
import { UseCaseProvider } from './context/UseCaseContext';
import { ChatProvider } from './context/ChatContext';
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

// ── Auth guard ────────────────────────────────────────────────────────────────
const PrivateRoute = ({ children }: { children: JSX.Element }) => {
  const isAuthenticated = localStorage.getItem('tavro_auth') === 'true';
  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

/**
 * Listens for 'tavro:unauthorized' dispatched by McpClientService (401 responses).
 * Uses React Router navigate() — soft redirect that preserves the console.
 */
function UnauthorizedHandler() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      console.warn('[App] tavro:unauthorized — navigating to /login:', detail?.body);
      navigate('/login', { replace: true });
    };
    window.addEventListener('tavro:unauthorized', handler);
    return () => window.removeEventListener('tavro:unauthorized', handler);
  }, [navigate]);
  return null;
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ChatProvider>
          <UnauthorizedHandler />
          <div className="App">
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
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
                <Route path="insights" element={<InsightsPage />} />
                <Route path="agent/:id" element={<AgentViewPage />} />
                <Route path="settings" element={<Settings />} />

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

              </Route>
            </Routes>
          </div>
        </ChatProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
