import React, { useState, useCallback, useEffect } from "react";
import { Link, useLocation, Outlet, useNavigate } from "react-router-dom";
import { Users, Calendar, BarChart3, Menu, Activity, LogOut, ClipboardList } from "lucide-react";
import { supabase } from '../../lib/supabaseClient';
import "./Layout.css";
import icon from '/electra-favicon.png';

const adminNavigationItems = [
  { title: "Schedule", url: "/schedule", icon: Calendar },
  { title: "Employees", url: "/employees", icon: Users },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Status", url: "/status", icon: Activity },
  { title: "Logs", url: "/logs", icon: ClipboardList },
];

const employeeNavigationItems = [
  { title: "My Schedule", url: "/employee", icon: Calendar }
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [userRole, setUserRole] = useState(() => localStorage.getItem('userRole'));

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), []);

  useEffect(() => {
    const handleStorage = () => {
      setUserRole(localStorage.getItem('userRole'));
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    setUserRole(localStorage.getItem('userRole'));
  }, [location.pathname]);

  // Supabase logout handler
  const handleLogout = useCallback(async () => {
    setLogoutLoading(true);
    try {
      // Sign out from Supabase
      const { error } = await supabase.auth.signOut();

      if (error) {
        console.error('Supabase logout error:', error);
        throw error;
      }

      console.log('Successfully logged out from Supabase');

      // Clear any local storage data
      localStorage.removeItem('supabase.auth.token');
      localStorage.removeItem('userRole');

      // Redirect to login page
      navigate('/login');

      // Close sidebar on mobile
      closeSidebar();

    } catch (error) {
      console.error('Logout failed:', error);
      alert('Logout failed. Please try again.');
    } finally {
      setLogoutLoading(false);
      setShowLogoutConfirm(false);
    }
  }, [navigate, closeSidebar]);

  // Show logout confirmation
  const confirmLogout = useCallback(() => {
    setShowLogoutConfirm(true);
  }, []);

  // Cancel logout
  const cancelLogout = useCallback(() => {
    setShowLogoutConfirm(false);
  }, []);

  return (
    <div className="layout-container">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-container">
            <div className="logo-icon">
              <img src={icon} alt="Electra Scheduler Logo" className="logo-image" />
            </div>
            <div>
              <h2 className="app-title">Electra Scheduler</h2>
              <p className="app-subtitle">Schedule Management App</p>
            </div>
          </div>
        </div>

        <nav className="sidebar-content">
          <div className="sidebar-group">
            <div className="sidebar-label">Navigation</div>
            <div className="sidebar-menu">
              {(userRole === 'employee' ? employeeNavigationItems : adminNavigationItems).map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.url;

                return (
                  <Link
                    key={item.title}
                    to={item.url}
                    className={`menu-item ${isActive ? 'menu-item-active' : ''}`}
                    onClick={closeSidebar}
                  >
                    <Icon className="menu-icon" />
                    <span className="menu-text">{item.title}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Logout Section */}
          <div className="sidebar-group logout-section">
            <div className="sidebar-menu">
              <button
                onClick={confirmLogout}
                className="menu-item logout-button"
                aria-label="Logout"
                disabled={logoutLoading}
              >
                <LogOut className="menu-icon" />
                <span className="menu-text">
                  {logoutLoading ? 'Logging out...' : 'Logout'}
                </span>
              </button>
            </div>
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <main className="main-content">
        <header className="mobile-header">
          <div className="header-content">
            <button
              onClick={toggleSidebar}
              className="menu-button"
              aria-label="Toggle sidebar"
            >
              <Menu className="menu-icon" />
            </button>
            <h1 className="mobile-title">Electra Scheduler</h1>
          </div>
        </header>

        <div className="content-area">
          <Outlet />
        </div>
      </main>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="overlay"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="logout-modal-overlay">
          <div className="logout-modal">
            <div className="logout-modal-header">
              <svg className="logout-modal-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <h3 className="logout-modal-title">Logout</h3>
            </div>

            <div className="logout-modal-body">
              <p className="logout-modal-message">
                Are you sure you want to logout from Electra Scheduler?
              </p>
            </div>

            <div className="logout-modal-actions">
              <button
                onClick={cancelLogout}
                className="logout-modal-button logout-modal-cancel"
                disabled={logoutLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="logout-modal-button logout-modal-confirm"
                disabled={logoutLoading}
              >
                {logoutLoading ? (
                  <>
                    <span className="logout-spinner"></span>
                    Logging out...
                  </>
                ) : (
                  'Logout'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}