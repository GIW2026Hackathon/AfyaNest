import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as api from '../services/api';
import {
  DEMO_ALERTS,
  DEMO_DEVICE,
  DEMO_LATEST,
  DEMO_SETTINGS,
  getDemoHistory,
} from '../services/demoData';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [demoMode, setDemoMode]           = useState(true);
  const [latestReading, setLatestReading] = useState(null);
  const [deviceStatus, setDeviceStatus]   = useState(null);
  const [alerts, setAlerts]               = useState([]);
  const [settings, setSettings]           = useState(DEMO_SETTINGS);
  const [backendOnline, setBackendOnline] = useState(false);
  const [unreadAlerts, setUnreadAlerts]   = useState(0);
  const pollRef = useRef(null);

  function getStatus(ammoniaAdc, cfg) {
    if (ammoniaAdc == null) return 'no_data';
    if (ammoniaAdc >= cfg.thresholds.danger)  return 'danger';
    if (ammoniaAdc >= cfg.thresholds.warning) return 'warning';
    return 'safe';
  }

  const refreshLatest = useCallback(async () => {
    if (demoMode) {
      const reading = { ...DEMO_LATEST, timestamp: new Date().toISOString() };
      reading.status = getStatus(reading.ammonia, settings);
      setLatestReading(reading);
      setDeviceStatus({ ...DEMO_DEVICE, last_update: new Date().toISOString() });
      return;
    }
    try {
      const data = await api.fetchLatestReading();
      data.status = getStatus(data.ammonia, settings);
      setLatestReading(data);
      setBackendOnline(true);
    } catch { setBackendOnline(false); }
    try {
      const ds = await api.fetchDeviceStatus();
      setDeviceStatus(ds);
    } catch { /* ignore */ }
  }, [demoMode, settings]);

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

  const updateSettings = useCallback(async (next) => {
    setSettings(next);
    if (!demoMode) {
      try { await api.saveSettings(next); } catch { /* ignore */ }
    }
  }, [demoMode]);

  const toggleDemoMode = useCallback((val) => {
    setDemoMode(val);
    setLatestReading(null);
    setDeviceStatus(null);
  }, []);

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

  async function loadHistory(range) {
    if (demoMode) return getDemoHistory(range);
    return api.fetchReadingHistory(range);
  }

  async function loadAnalytics(from, to) {
    if (demoMode) {
      const readings = getDemoHistory('24h');
      const avg = (arr, key) => Math.round(arr.reduce((s, r) => s + r[key], 0) / arr.length * 10) / 10;
      const min = (arr, key) => Math.min(...arr.map(r => r[key]));
      const max = (arr, key) => Math.max(...arr.map(r => r[key]));
      return {
        ammonia:     { avg: avg(readings, 'ammonia'),     min: min(readings, 'ammonia'),     max: max(readings, 'ammonia') },
        temperature: { avg: avg(readings, 'temperature'), min: min(readings, 'temperature'), max: max(readings, 'temperature') },
        humidity:    { avg: avg(readings, 'humidity'),    min: min(readings, 'humidity'),    max: max(readings, 'humidity') },
        warnings: 3,
        dangers:  1,
        readings,
      };
    }
    return api.fetchAnalytics(from, to);
  }

  async function loadSettings() {
    if (demoMode) return DEMO_SETTINGS;
    return api.fetchSettings();
  }

  const value = {
    demoMode, toggleDemoMode,
    latestReading, deviceStatus,
    alerts, unreadAlerts,
    settings, updateSettings,
    backendOnline,
    refreshLatest, refreshAlerts,
    loadHistory, loadAnalytics, loadSettings,
    getStatus: (adc) => getStatus(adc, settings),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
