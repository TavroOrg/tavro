import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import AdminLogin from './pages/AdminLogin';
import AdminLayout from './pages/AdminLayout';
import AdminConnectorsPage from './pages/AdminConnectorsPage';
import AdminSettingsPage from './pages/AdminSettingsPage';

const AdminRoute = ({ children }: { children: React.ReactElement }) => {
  const isAdmin = localStorage.getItem('tavro_admin_auth') === 'true';
  return isAdmin ? children : <Navigate to="/login" replace />;
};

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <Routes>
          <Route path="/login" element={<AdminLogin />} />
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
            <Route path="settings" element={<AdminSettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
