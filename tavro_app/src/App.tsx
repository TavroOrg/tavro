import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  LAST_ACTIVITY_KEY,
  SESSION_TIMEOUT_MS,
  SESSION_WARNING_MS,
  clearAuth,
  getLastSessionActivity,
  isAccessTokenExpired,
  isAccessTokenHardExpired,
  isSessionInactive,
  recordSessionActivity,
  refreshAccessToken,
  signalSessionExpired,
  type SessionExpiredReason,
} from './services/auth';
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
import AiModelsPage from './pages/AiModelsPage';
import AiModelViewPage from './pages/AiModelViewPage';
import IntegrationsPage from './pages/IntegrationsPage';
import IntegrationViewPage from './pages/IntegrationViewPage';
import SparkPage from './pages/SparkPage';
import UserGuidePage from './pages/UserGuidePage';
import IssueViewPage from './pages/IssueViewPage';
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
    const handler = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: SessionExpiredReason }>).detail?.reason;
      if (reason !== 'inactive') {
        setStatus('expired');
      }
    };
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

function SessionTimeoutHandler() {
  useEffect(() => {
    let timeoutId: number | undefined;
    let warningId: number | undefined;
    let lastRecordedAt = 0;

    const isLoggedIn = () => localStorage.getItem('tavro_auth') === 'true';

    const clearExistingTimer = () => {
      if (timeoutId !== undefined) { window.clearTimeout(timeoutId); timeoutId = undefined; }
      if (warningId !== undefined) { window.clearTimeout(warningId); warningId = undefined; }
    };

    const expireIfInactive = () => {
      if (!isLoggedIn()) { clearExistingTimer(); return; }
      if (isSessionInactive()) {
        signalSessionExpired('inactive');
        clearExistingTimer();
        return;
      }
      scheduleTimeout();
    };

    const scheduleTimeout = () => {
      clearExistingTimer();
      if (!isLoggedIn()) return;
      const elapsed = Date.now() - getLastSessionActivity();
      const remaining = Math.max(0, SESSION_TIMEOUT_MS - elapsed);
      const warningIn = Math.max(0, SESSION_TIMEOUT_MS - SESSION_WARNING_MS - elapsed);
      timeoutId = window.setTimeout(expireIfInactive, remaining);
      warningId = window.setTimeout(() => {
        if (isLoggedIn() && !isSessionInactive()) {
          window.dispatchEvent(new CustomEvent('tavro:session_warning'));
        }
      }, warningIn);
    };

    const recordActivity = () => {
      if (!isLoggedIn()) return;
      if (isSessionInactive()) {
        signalSessionExpired('inactive');
        clearExistingTimer();
        return;
      }
      const now = Date.now();
      if (now - lastRecordedAt < 1000) return;
      lastRecordedAt = now;
      recordSessionActivity(now);
      scheduleTimeout();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') expireIfInactive();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LAST_ACTIVITY_KEY || event.key === 'tavro_auth') scheduleTimeout();
    };

    if (isLoggedIn() && !localStorage.getItem(LAST_ACTIVITY_KEY)) recordSessionActivity();
    scheduleTimeout();

    const activityEvents = ['keydown', 'mousedown', 'mousemove', 'pointerdown', 'scroll', 'touchstart', 'wheel'] as const;
    activityEvents.forEach(e => window.addEventListener(e, recordActivity, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('tavro:session_activity', recordActivity);

    return () => {
      clearExistingTimer();
      activityEvents.forEach(e => window.removeEventListener(e, recordActivity));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('tavro:session_activity', recordActivity);
    };
  }, []);

  return null;
}

function SessionWarningHandler() {
  const [show, setShow] = useState(false);
  const [remaining, setRemaining] = useState(SESSION_WARNING_MS);

  useEffect(() => {
    let countdownId: number | undefined;

    const onWarning = () => {
      setRemaining(SESSION_WARNING_MS);
      setShow(true);
      countdownId = window.setInterval(() => {
        setRemaining((prev: number) => {
          if (prev <= 1000) { clearInterval(countdownId); return 0; }
          return prev - 1000;
        });
      }, 1000);
    };

    const onDismiss = () => {
      setShow(false);
      if (countdownId) clearInterval(countdownId);
    };

    window.addEventListener('tavro:session_warning', onWarning);
    window.addEventListener('tavro:session_warning_dismiss', onDismiss);
    window.addEventListener('tavro:session_expired', onDismiss);
    return () => {
      window.removeEventListener('tavro:session_warning', onWarning);
      window.removeEventListener('tavro:session_warning_dismiss', onDismiss);
      window.removeEventListener('tavro:session_expired', onDismiss);
      if (countdownId) clearInterval(countdownId);
    };
  }, []);

  const extendSession = () => {
    recordSessionActivity();
    window.dispatchEvent(new CustomEvent('tavro:session_activity'));
    setShow(false);
  };

  const minutes = Math.ceil(remaining / 60000);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-[420px] border-2 border-amber-500 bg-white p-6 shadow-2xl rounded-lg">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-slate-900">Session Expiring Soon</h2>
          <button
            type="button"
            onClick={extendSession}
            className="flex h-7 w-7 items-center justify-center border border-slate-300 text-slate-500 hover:bg-slate-50 rounded"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mb-6 text-sm text-slate-700">
          Your session will expire in <span className="font-semibold text-amber-600">{minutes} minute{minutes !== 1 ? 's' : ''}</span> due to inactivity.
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={extendSession}
            className="rounded bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Extend Session
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Listens for 'tavro:session_expired' — dispatched by API clients when a
 * token refresh attempt fails. Clears auth state then soft-redirects to /login.
 */
// function SessionExpiredHandler() {
//   const navigate = useNavigate();
//   const [showTimeoutDialog, setShowTimeoutDialog] = useState(false);

//   const goToLogin = () => {
//     setShowTimeoutDialog(false);
//     navigate('/login?reason=timeout', { replace: true });
//   };

//   useEffect(() => {
//     const handler = (event: Event) => {
//       const reason = (event as CustomEvent<{ reason?: SessionExpiredReason }>).detail?.reason;
//       console.warn('[App] tavro:session_expired — clearing auth and navigating to /login');
//       clearAuth();
//       if (reason === 'inactive') {
//         setShowTimeoutDialog(true);
//         return;
//       }
//       navigate('/login', { replace: true });
//     };
//     window.addEventListener('tavro:session_expired', handler);
//     return () => window.removeEventListener('tavro:session_expired', handler);
//   }, [navigate]);

//   if (!showTimeoutDialog) return null;

//   return (
//     <div
//       className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 px-4"
//       role="presentation"
//     >
//       <div
//         className="w-full max-w-[420px] border-2 border-red-500 bg-white p-6 shadow-2xl"
//         role="dialog"
//         aria-modal="true"
//         aria-labelledby="session-expired-title"
//       >
//         <div className="mb-6 flex items-start justify-between gap-4">
//           <h2 id="session-expired-title" className="text-lg font-bold text-slate-900">
//             Session Expired (401)
//           </h2>
//           <button
//             type="button"
//             onClick={goToLogin}
//             className="flex h-7 w-7 items-center justify-center border border-blue-700 text-blue-800 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
//             aria-label="Close dialog and log in again"
//             title="Close dialog"
//           >
//             <X size={20} strokeWidth={2} />
//           </button>
//         </div>
//         <p className="mb-10 text-sm text-slate-700">Required to provide Auth information</p>
//         <div className="flex justify-end">
//           <button
//             type="button"
//             onClick={goToLogin}
//             className="rounded bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
//           >
//             Log in
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// }

function SessionExpiredHandler() {
  const navigate = useNavigate();
  const [showTimeoutDialog, setShowTimeoutDialog] = useState(false);

  const goToLogin = () => {
    setShowTimeoutDialog(false);
    navigate('/login?reason=timeout', { replace: true });
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: SessionExpiredReason }>).detail?.reason;

      if (reason === 'inactive') {
        console.warn('[App] Session expired due to inactivity');
        clearAuth();
        setShowTimeoutDialog(true);
        return;
      }

      clearAuth();
      navigate('/login', { replace: true });
    };

    window.addEventListener('tavro:session_expired', handler);
    return () => window.removeEventListener('tavro:session_expired', handler);
  }, [navigate]);

  if (!showTimeoutDialog) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-[420px] border-2 border-red-500 bg-white p-6 shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-slate-900">Session Expired (401)</h2>
          <button
            type="button"
            onClick={goToLogin}
            className="flex h-7 w-7 items-center justify-center border border-blue-700 text-blue-800"
          >
            <X size={20} />
          </button>
        </div>

        <p className="mb-10 text-sm text-slate-700">
          Required to provide Auth information
        </p>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={goToLogin}
            className="rounded bg-indigo-600 px-5 py-2 text-sm font-semibold text-white"
          >
            Log in
          </button>
        </div>
      </div>
    </div>
  );
}



// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ChatSessionProvider>
        <ChatProvider>
          <SessionExpiredHandler />
          <SessionTimeoutHandler />
          <SessionWarningHandler />
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
                <Route path="applications" element={<BusinessApplicationsPage />} />
                <Route path="applications/new" element={<BusinessApplicationViewPage />} />
                <Route path="applications/:id" element={<BusinessApplicationViewPage />} />
                <Route path="processes" element={<BusinessProcessesPage />} />
                <Route path="processes/new" element={<BusinessProcessViewPage />} />
                <Route path="processes/:id" element={<BusinessProcessViewPage />} />
                <Route path="ai-models" element={<AiModelsPage />} />
                <Route path="ai-models/new" element={<AiModelViewPage />} />
                <Route path="ai-models/:id" element={<AiModelViewPage />} />
                <Route path="integrations" element={<IntegrationsPage />} />
                <Route path="integrations/new" element={<IntegrationViewPage />} />
                <Route path="integrations/:id" element={<IntegrationViewPage />} />

                <Route path="issues/:id" element={<IssueViewPage />} />
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
