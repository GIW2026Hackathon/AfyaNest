import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, User, Usb, WifiOff } from 'lucide-react';
import { useApp } from '../context/AppContext';

const PAGE_TITLES = {
  '/':           'Overview',
  '/live':       'Live Monitoring',
  '/analytics':  'Environmental Analytics',
  '/alerts':     'Alert History',
  '/insights':   'AI Insights',
  '/device':     'Device Status',
  '/settings':   'Settings',
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
  const { unreadAlerts, deviceStatus, demoMode, backendOnline } = useApp();
  const location = useLocation();
  const now = useDateTime();

  const pageTitle = PAGE_TITLES[location.pathname] ?? 'AfyaNest';

  const deviceConnected = !demoMode && deviceStatus?.connected;

  const dateStr = now.toLocaleDateString('en-KE', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-KE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  return (
    <header className="topbar" role="banner">
      <h1 className="topbar__title">{pageTitle}</h1>

      <div className="topbar__right">
        {/* Date / Time */}
        <div className="topbar__datetime" aria-live="off" aria-atomic="true">
          <span>{dateStr}</span>
          <span className="topbar__time">{timeStr}</span>
        </div>

        {/* Device connection pill */}
        <div
          className={`topbar__device ${deviceConnected ? 'topbar__device--connected' : 'topbar__device--disconnected'}`}
          aria-label={deviceConnected ? 'Arduino connected via USB' : 'Arduino not connected'}
          title={deviceConnected ? 'Arduino connected via USB' : 'Arduino disconnected or demo mode active'}
        >
          {deviceConnected
            ? <Usb size={14} aria-hidden="true" />
            : <WifiOff size={14} aria-hidden="true" />
          }
          <span>{deviceConnected ? 'Arduino Connected' : demoMode ? 'Demo Mode' : 'Not Connected'}</span>
        </div>

        {/* Notification bell */}
        <button
          className="topbar__bell"
          aria-label={`Notifications${unreadAlerts > 0 ? `, ${unreadAlerts} unread` : ''}`}
        >
          <Bell size={18} aria-hidden="true" />
          {unreadAlerts > 0 && (
            <span className="topbar__badge" aria-hidden="true">
              {unreadAlerts > 9 ? '9+' : unreadAlerts}
            </span>
          )}
        </button>

        {/* User profile */}
        <div className="topbar__user" aria-label="Signed in as Farm Manager">
          <div className="topbar__avatar" aria-hidden="true">
            <User size={16} />
          </div>
          <span className="topbar__username">Farm Manager</span>
        </div>
      </div>
    </header>
  );
}
