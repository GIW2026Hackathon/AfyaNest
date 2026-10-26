import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import DashboardLayout from './layout/DashboardLayout';
import Overview from './pages/Overview/index';
import LiveMonitoring from './pages/LiveMonitoring/index';
import Analytics from './pages/Analytics/index';
import AlertHistory from './pages/AlertHistory/index';
import AIInsights from './pages/AIInsights/index';
import DeviceStatus from './pages/DeviceStatus/index';
import Settings from './pages/Settings/index';

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <DashboardLayout>
          <Routes>
            <Route path="/"          element={<Overview />} />
            <Route path="/live"      element={<LiveMonitoring />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/alerts"    element={<AlertHistory />} />
            <Route path="/insights"  element={<AIInsights />} />
            <Route path="/device"    element={<DeviceStatus />} />
            <Route path="/settings"  element={<Settings />} />
          </Routes>
        </DashboardLayout>
      </AppProvider>
    </BrowserRouter>
  );
}
