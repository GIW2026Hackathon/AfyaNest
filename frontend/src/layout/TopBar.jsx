import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, User, Usb, WifiOff } from 'lucide-react';
import { useApp } from '../context/AppContext';

const PAGE_TITLES = {
  '/':          'Live Monitoring',
  '/alerts':    'Alerts',
  '/insights':  'AI Prediction',
  '/device':    'Device',
  '/settings':  'Settings',
};

function useDateTime() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function TopBar() {
  const { unreadAlerts, deviceStatus, demoMode } = useApp();
  const location = useLocation();
  const now = useDateTime();

  const pageTitle = PAGE_TITLES[location.pathname] ?? 'AfyaNest';
  const deviceConnected = !demoMode && deviceStatus?.connected;

  const timeStr = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('en-KE', { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <header className="topbar" role="banner">
      <h1 className="topbar__title">{pageTitle}</h1>

      <div className="topbar__right">
        <div className="topbar__datetime">
          <span>{dateStr}</span>
          <span className="topbar__time">{timeStr}</span>
        </div>

        <div
          className={`topbar__device ${deviceConnected ? 'topbar__device--connected' : 'topbar__device--disconnected'}`}
          title={deviceConnected ? 'Arduino connected via USB' : 'Not connected'}
        >
          {deviceConnected ? <Usb size={14} /> : <WifiOff size={14} />}
          <span>{deviceConnected ? 'USB' : demoMode ? 'Demo' : 'Offline'}</span>
        </div>

        <button className="topbar__bell" aria-label={`Alerts${unreadAlerts > 0 ? ` (${unreadAlerts})` : ''}`}>
          <Bell size={18} />
          {unreadAlerts > 0 && <span className="topbar__badge">{unreadAlerts > 9 ? '9+' : unreadAlerts}</span>}
        </button>

        <div className="topbar__user">
          <div className="topbar__avatar"><User size={16} /></div>
          <span className="topbar__username">Farm Manager</span>
        </div>
      </div>
    </header>
  );
}
