import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity, Bell, BrainCircuit, Cpu, Settings,
  Menu, X, Bird, Wifi, WifiOff,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

const NAV_ITEMS = [
  { to: '/',          label: 'Live Monitoring', Icon: Activity },
  { to: '/alerts',    label: 'Alerts',          Icon: Bell },
  { to: '/insights',  label: 'AI Prediction',   Icon: BrainCircuit },
  { to: '/device',    label: 'Device',          Icon: Cpu },
  { to: '/settings',  label: 'Settings',        Icon: Settings },
];

export default function Sidebar() {
  const { backendOnline, demoMode } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isConnected = !demoMode && backendOnline;

  const SidebarContent = () => (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__brand-icon" aria-hidden="true">
          <Bird size={22} strokeWidth={1.8} />
        </div>
        <div>
          <div className="sidebar__brand-name">AfyaNest</div>
          <div className="sidebar__brand-sub">Poultry Monitoring</div>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="Main navigation">
        <ul role="list">
          {NAV_ITEMS.map(({ to, label, Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `sidebar__nav-item ${isActive ? 'sidebar__nav-item--active' : ''}`
                }
                onClick={() => setMobileOpen(false)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__connection">
          {isConnected ? (
            <><Wifi size={13} color="#16A34A" /><span style={{ color: '#16A34A' }}>Connected</span></>
          ) : demoMode ? (
            <><WifiOff size={13} color="#EAB308" /><span style={{ color: '#EAB308' }}>Demo</span></>
          ) : (
            <><WifiOff size={13} color="#DC2626" /><span style={{ color: '#DC2626' }}>Offline</span></>
          )}
        </div>
        <div className="sidebar__version">v1.0</div>
      </div>
    </aside>
  );

  return (
    <>
      <div className="sidebar-wrapper sidebar-wrapper--desktop">
        <SidebarContent />
      </div>

      <button
        className="sidebar__mobile-toggle"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        aria-expanded={mobileOpen}
      >
        <Menu size={22} />
      </button>

      {mobileOpen && (
        <>
          <div className="sidebar__overlay" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div className="sidebar-wrapper sidebar-wrapper--mobile">
            <button className="sidebar__mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X size={20} />
            </button>
            <SidebarContent />
          </div>
        </>
      )}
    </>
  );
}
