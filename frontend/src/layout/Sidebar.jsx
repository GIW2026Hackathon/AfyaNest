import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Activity,
  BarChart2,
  Bell,
  Lightbulb,
  Cpu,
  Settings,
  Menu,
  X,
  Bird,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

const NAV_ITEMS = [
  { to: '/',               label: 'Overview',                Icon: LayoutDashboard },
  { to: '/live',           label: 'Live Monitoring',         Icon: Activity },
  { to: '/analytics',      label: 'Environmental Analytics', Icon: BarChart2 },
  { to: '/alerts',         label: 'Alert History',           Icon: Bell },
  { to: '/insights',       label: 'AI Insights',             Icon: Lightbulb },
  { to: '/device',         label: 'Device Status',           Icon: Cpu },
  { to: '/settings',       label: 'Settings',                Icon: Settings },
];

export default function Sidebar() {
  const { backendOnline, demoMode } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isConnected = !demoMode && backendOnline;

  const SidebarContent = () => (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar__brand">
        <div className="sidebar__brand-icon" aria-hidden="true">
          <Bird size={22} strokeWidth={1.8} />
        </div>
        <div>
          <div className="sidebar__brand-name">AfyaNest</div>
          <div className="sidebar__brand-sub">Smart Poultry Monitoring</div>
        </div>
      </div>

      {/* Navigation */}
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

      {/* Footer */}
      <div className="sidebar__footer">
        <div className="sidebar__connection">
          {isConnected ? (
            <>
              <Wifi size={13} color="#16A34A" aria-hidden="true" />
              <span style={{ color: '#16A34A' }}>System Connected</span>
            </>
          ) : demoMode ? (
            <>
              <WifiOff size={13} color="#EAB308" aria-hidden="true" />
              <span style={{ color: '#EAB308' }}>Demo Mode</span>
            </>
          ) : (
            <>
              <WifiOff size={13} color="#DC2626" aria-hidden="true" />
              <span style={{ color: '#DC2626' }}>Disconnected</span>
            </>
          )}
        </div>
        <div className="sidebar__version">Prototype v1.0</div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div className="sidebar-wrapper sidebar-wrapper--desktop">
        <SidebarContent />
      </div>

      {/* Mobile toggle button */}
      <button
        className="sidebar__mobile-toggle"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={mobileOpen}
      >
        <Menu size={22} />
      </button>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="sidebar__overlay"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="sidebar-wrapper sidebar-wrapper--mobile">
            <button
              className="sidebar__mobile-close"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
            >
              <X size={20} />
            </button>
            <SidebarContent />
          </div>
        </>
      )}
    </>
  );
}
