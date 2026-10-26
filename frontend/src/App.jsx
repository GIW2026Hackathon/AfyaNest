import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import DashboardLayout from './layout/DashboardLayout';
import LiveMonitoring from './pages/LiveMonitoring/index';
import AlertHistory from './pages/AlertHistory/index';
import AIPrediction from './pages/AIInsights/index';
import DeviceStatus from './pages/DeviceStatus/index';
import Settings from './pages/Settings/index';

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <DashboardLayout>
          <Routes>
            <Route path="/"          element={<LiveMonitoring />} />
            <Route path="/alerts"    element={<AlertHistory />} />
            <Route path="/insights"  element={<AIPrediction />} />
            <Route path="/device"    element={<DeviceStatus />} />
            <Route path="/settings"  element={<Settings />} />
            {/* redirect old routes */}
            <Route path="/live"      element={<Navigate to="/" replace />} />
            <Route path="/analytics" element={<Navigate to="/" replace />} />
          </Routes>
        </DashboardLayout>
      </AppProvider>
    </BrowserRouter>
  );
}
