/**
 * AfyaNest — AppContext
 *
 * Manages global state: demo/live mode, device selection,
 * sensor readings, alerts, and settings.
 *
 * In live mode all data comes from the AirNest FastAPI backend.
 * In demo mode all data comes from demoData.js (no network calls).
 */
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

// ── Threshold helpers ────────────────────────────────────────────────────────

function getStatus(ammoniaVal, cfg) {
  // In live mode the backend already sets level via ML — use that if available.
  // Fallback to local thresholds when only raw ADC is available.
  if (ammoniaVal == null) return 'no_data';
  if (ammoniaVal >= cfg.thresholds.danger)  return 'danger';
  if (ammoniaVal >= cfg.thresholds.warning) return 'warning';
  return 'safe';
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function AppProvider({ children }) {
  const [demoMode, setDemoMode]           = useState(true);
  const [deviceId, setDeviceId]           = useState(null);   // active house
  const [houses, setHouses]               = useState([]);      // all registered houses
  const [latestReading, setLatestReading] = useState(null);
  const [deviceStatus, setDeviceStatus]   = useState(null);
  const [alerts, setAlerts]               = useState([]);
  const [unreadAlerts, setUnreadAlerts]   = useState(0);
  const [backendOnline, setBackendOnline] = useState(false);
  const [settings, setSettings]           = useState(DEMO_SETTINGS);
  const pollRef = useRef(null);

  // ── Refresh latest reading ────────────────────────────────────────────────

  const refreshLatest = useCallback(async () => {
    if (demoMode) {
      const r = { ...DEMO_LATEST, timestamp: new Date().toISOString() };
      r.status = getStatus(r.ammonia, settings);
      setLatestReading(r);
      setDeviceStatus({ ...DEMO_DEVICE, last_update: new Date().toISOString() });
      setBackendOnline(false);
      return;
    }

    // ── Live mode ──
    try {
      // 1. Check backend health
      await api.fetchHealth();
      setBackendOnline(true);
    } catch {
      setBackendOnline(false);
      return;
    }

    // 2. Load house list if not yet loaded
    let activeId = deviceId;
    if (!activeId) {
      try {
        const list = await api.fetchHouses();
        setHouses(list ?? []);
        if (list && list.length > 0) {
          activeId = list[0].device_id;
          setDeviceId(activeId);
        }
      } catch { return; }
    }

    if (!activeId) return;

    // 3. Get latest reading for the active house
    try {
      const reading = await api.fetchLatestReading(activeId);
      // If the backend already provides a mapped level, trust it; otherwise threshold
      if (!reading.status || reading.status === 'no_data') {
        reading.status = getStatus(reading.ammonia, settings);
      }
      setLatestReading(reading);
      setDeviceStatus({ connected: true, port: 'Network', last_update: reading.timestamp });
    } catch {
      setLatestReading(prev => prev ? { ...prev, device_connected: false } : null);
      setDeviceStatus({ connected: false });
    }
  }, [demoMode, deviceId, settings]);

  // ── Refresh alerts ────────────────────────────────────────────────────────

  const refreshAlerts = useCallback(async () => {
    if (demoMode) {
      setAlerts(DEMO_ALERTS);
      setUnreadAlerts(DEMO_ALERTS.filter(a => a.status !== 'resolved').length);
      return;
    }
    if (!deviceId) return;
    try {
      const data = await api.fetchAlerts(deviceId, 24);
      setAlerts(data ?? []);
      setUnreadAlerts((data ?? []).filter(a => a.status !== 'resolved').length);
    } catch { /* keep previous */ }
  }, [demoMode, deviceId]);

  // ── Toggle demo / live mode ───────────────────────────────────────────────

  const toggleDemoMode = useCallback((val) => {
    setDemoMode(val);
    setLatestReading(null);
    setDeviceStatus(null);
    setAlerts([]);
    if (val) setDeviceId(null); // reset when going back to demo
  }, []);

  // ── Settings ──────────────────────────────────────────────────────────────

  const updateSettings = useCallback((next) => {
    setSettings(next);
    // Settings are local-only for now (no backend settings endpoint)
  }, []);

  // ── Polling ───────────────────────────────────────────────────────────────

  useEffect(() => {
    refreshLatest();
    refreshAlerts();
    const ms = demoMode ? 30_000 : 60_000; // backend updates every 10 min; poll every 60s
    pollRef.current = setInterval(() => {
      refreshLatest();
      refreshAlerts();
    }, ms);
    return () => clearInterval(pollRef.current);
  }, [demoMode, refreshLatest, refreshAlerts]);

  // ── On-demand data loaders ────────────────────────────────────────────────

  async function loadHistory(range) {
    if (demoMode) return getDemoHistory(range);
    if (!deviceId) return [];
    return api.fetchReadingHistory(deviceId, range);
  }

  async function loadSettings() {
    return settings; // no backend settings endpoint yet
  }

  // ── Context value ─────────────────────────────────────────────────────────

  const value = {
    // mode
    demoMode, toggleDemoMode,
    // house selection
    deviceId, setDeviceId, houses,
    // data
    latestReading, deviceStatus,
    alerts, unreadAlerts,
    settings, updateSettings,
    // connection
    backendOnline,
    // actions
    refreshLatest, refreshAlerts,
    loadHistory, loadSettings,
    // helpers
    getStatus: (v) => getStatus(v, settings),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
