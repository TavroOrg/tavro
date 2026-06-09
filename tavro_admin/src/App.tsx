import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import AdminLogin from './pages/AdminLogin';
import AuthCallback from './pages/AuthCallback';
import AdminLayout from './pages/AdminLayout';
import AdminConnectorsPage from './pages/AdminConnectorsPage';
import AdminContainerLogsPage from './pages/AdminContainerLogsPage';
import AdminSettingsPage from './pages/AdminSettingsPage';

function isAuthenticated(): boolean {
    const token = localStorage.getItem('tavro_admin_access_token');
    if (!token) return false;
    try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp && payload.exp * 1000 < Date.now()) {
            localStorage.removeItem('tavro_admin_access_token');
            localStorage.removeItem('tavro_admin_auth');
            return false;
        }
    } catch { /* ignore malformed token */ }
    return true;
}

const AdminRoute = ({ children }: { children: React.ReactElement }) => {
    return isAuthenticated() ? children : <Navigate to="/login" replace />;
};

function App() {
    return (
        <BrowserRouter>
            <ThemeProvider>
                <Routes>
                    <Route path="/login" element={<AdminLogin />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route
                        path="/"
                        element={
                            <AdminRoute>
                                <AdminLayout />
                            </AdminRoute>
                        }
                    >
                        <Route index element={<AdminConnectorsPage />} />
                        <Route path="connectors" element={<AdminConnectorsPage />} />
                        <Route path="container-logs" element={<AdminContainerLogsPage />} />
                        <Route path="settings" element={<AdminSettingsPage />} />
                    </Route>
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </ThemeProvider>
        </BrowserRouter>
    );
}

export default App;
