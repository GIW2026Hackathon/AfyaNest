import Sidebar from './Sidebar';
import TopBar from './TopBar';
import DemoBanner from '../components/DemoBanner';

/**
 * DashboardLayout — wraps every page with the sidebar, topbar and demo banner.
 */
export default function DashboardLayout({ children }) {
  return (
    <div className="dashboard-layout">
      <Sidebar />

      <div className="dashboard-layout__main">
        <DemoBanner />
        <TopBar />
        <main className="dashboard-layout__content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
