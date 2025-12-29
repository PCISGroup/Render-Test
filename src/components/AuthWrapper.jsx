import { useState, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

const AuthWrapper = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    const checkAuth = async () => {
      console.log('🔄 AuthWrapper checking authentication...');
      console.log('📍 Current path:', location.pathname);
      
      // CRITICAL: If we're on the OAuth callback route, DON'T redirect
      if (location.pathname === '/auth/callback') {
        console.log('🎯 On callback route - waiting for OAuth to complete');
        setLoading(false);
        return; // Don't check auth, let the callback handle it
      }
      
      try {
        const { data: { session } } = await supabase.auth.getSession();
        console.log('🔍 Supabase session found:', !!session);
        
        if (session) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      } catch (error) {
        console.error('Auth check error:', error);
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [location.pathname]); // Re-run when path changes

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  console.log('📊 Final auth status:', isAuthenticated, 'Path:', location.pathname);

  // Special handling for callback route
  if (location.pathname === '/auth/callback') {
    console.log('✅ Allowing callback route to render');
    return <Outlet />;
  }

  // If not authenticated and not on callback, redirect to login
  if (!isAuthenticated) {
    console.log('➡️ Redirecting to /login');
    return <Navigate to="/login" replace />;
  }

  // If authenticated, render the child routes
  console.log('✅ User authenticated, rendering protected routes');
  return <Outlet />;
};

export default AuthWrapper;