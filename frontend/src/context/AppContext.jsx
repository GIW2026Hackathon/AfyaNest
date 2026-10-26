import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as api from '../services/api';
import {
  DEMO_ALERTS,
  DEMO_ANALYTICS,
  DEMO_DEVICE,
  DEMO_HISTORY,
  DEMO_LATEST,
  DEMO_SETTINGS,
} from '../services/demoData';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [demoMode, setDemoMode] = useState(true); // start in demo until backend confirmed
  const [latestReading, setLatestReading] = useState(null);
  const [deviceStatus, setDeviceStatus] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [settings, setSettings] = useState(DEMO_SETTINGS);
  const [backendOnline, setBackendOnline] = useState(false);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const pollRef = useRef(null);

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function getStatus(ammoniaAdc, settings) {
    if (ammoniaAdc == null) return 'no_data';
    if (ammoniaAdc >= settings.thresholds.danger)  return 'danger';
    if (ammoniaAdc >= settings.thresholds.warning) return 'warning';
    return 'safe';
  }

  // ------------------------------------------------------------------
  // Fetch latest reading (live or demo)
  // ------------------------------------------------------------------
  const refreshLatest = useCallback(async () => {
    if (demoMode) {
      const reading = { ...DEMO_LATEST, timestamp: new Date().toISOString() };
      reading.status = getStatus(reading.ammonia, settings);
      setLatestReading(reading);
      setDeviceStatus(DEMO_DEVICE);
      return;
    }
    try {
      const data = await api.fetchLatestReading();
      data.status = getStatus(data.ammonia, settings);
      setLatestReading(data);
      setBackendOnline(true);
    } catch {
      setBackendOnline(false);
    }
    try {
      const ds = await api.fetchDeviceStatus();
      setDeviceStatus(ds);
    } catch { /* ignore */ }
  }, [demoMode, settings]);

  // ------------------------------------------------------------------
  // Fetch alerts
  // ------------------------------------------------------------------
  const refreshAlerts = useCallback(async () => {
    if (demoMode) {
      setAlerts(DEMO_ALERTS);
      setUnreadAlerts(DEMO_ALERTS.filter(a => a.status !== 'resolved').length);
      return;
    }
    try {
      const data = await api.fetchAlerts();
      setAlerts(data);
      setUnreadAlerts(data.filter(a => a.status !== 'resolved').length);
    } catch { /* ignore */ }
  }, [demoMode]);

  // ------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------
  const updateSettings = useCallback(async (next) => {
    setSettings(next);
    if (!demoMode) {
      try { await api.saveSettings(next); } catch { /* ignore */ }
    }
  }, [demoMode]);

  // ------------------------------------------------------------------
  // Toggle demo mode
  // ------------------------------------------------------------------
  const toggleDemoMode = useCallback((val) => {
    setDemoMode(val);
    setLatestReading(null);
    setDeviceStatus(null);
  }, []);

  // ------------------------------------------------------------------
  // Polling (every 5 s in live mode, 30 s in demo)
  // ------------------------------------------------------------------
  useEffect(() => {
    refreshLatest();
    refreshAlerts();
    const interval = demoMode ? 30_000 : 5_000;
    pollRef.current = setInterval(() => {
      refreshLatest();
      refreshAlerts();
    }, interval);
    return () => clearInterval(pollRef.current);
  }, [demoMode, refreshLatest, refreshAlerts]);

  // ------------------------------------------------------------------
  // History / analytics helpers (called on demand by pages)
  // ------------------------------------------------------------------
  async function loadHistory(range) {
    if (demoMode) return DEMO_HISTORY[range] ?? DEMO_HISTORY['1h'];
    return api.fetchReadingHistory(range);
  }

  async function loadAnalytics(from, to) {
    if (demoMode) return DEMO_ANALYTICS;
    return api.fetchAnalytics(from, to);
  }

  async function loadSettings() {
    if (demoMode) return DEMO_SETTINGS;
    return api.fetchSettings();
  }

  const value = {
    demoMode,
    toggleDemoMode,
    latestReading,
    deviceStatus,
    alerts,
    unreadAlerts,
    settings,
    updateSettings,
    backendOnline,
    refreshLatest,
    refreshAlerts,
    loadHistory,
    loadAnalytics,
    loadSettings,
    getStatus: (adc) => getStatus(adc, settings),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
