import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import './Login.css';

const AdminLogin = () => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [loginMode, setLoginMode] = useState('admin');
  const [extension, setExtension] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [lookupStatus, setLookupStatus] = useState('idle');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        const userRole = localStorage.getItem('userRole');
        // Only redirect if we have a valid role to prevent redirect loops
        if (userRole) {
          window.location.href = userRole === 'employee' ? '/employee' : '/schedule';
        } else {
          // Session exists but no role - clear it to allow fresh login
          console.log('Session found but no userRole - clearing session');
          supabase.auth.signOut();
          localStorage.clear();
        }
      }
    });
  }, []);

  useEffect(() => {
    if (loginMode !== 'employee') {
      setEmployeeName('');
      setLookupStatus('idle');
      return;
    }

    const extValue = extension.trim();
    if (!extValue) {
      setEmployeeName('');
      setLookupStatus('idle');
      return;
    }

    let isActive = true;
    setLookupStatus('loading');

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL}/api/auth/employee-by-extension?extension=${encodeURIComponent(extValue)}`
        );
        const data = await res.json().catch(() => ({}));

        if (!isActive) return;

        if (!res.ok) {
          setEmployeeName('');
          setLookupStatus('error');
          return;
        }

        if (data.found && data.multiple) {
          setEmployeeName(data.name || '');
          setLookupStatus('multiple');
          return;
        }

        if (data.found) {
          setEmployeeName(data.name || '');
          setLookupStatus('found');
          return;
        }

        setEmployeeName('');
        setLookupStatus('not_found');
      } catch (err) {
        if (!isActive) return;
        setEmployeeName('');
        setLookupStatus('error');
      }
    }, 400);

    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [loginMode, extension]);

  const signInWithMicrosoft = async () => {
    setLoading(true);
    setMessage('Redirecting to Microsoft...');

    if (loginMode === 'employee') {
      const extValue = extension.trim();
      if (!extValue) {
        setLoading(false);
        setMessage('Please enter your extension.');
        return;
      }

      if (lookupStatus !== 'found') {
        setLoading(false);
        setMessage('Extension not verified. Please check and try again.');
        return;
      }

      localStorage.setItem('loginExtension', extValue);
    } else {
      localStorage.removeItem('loginExtension');
    }
    
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'azure',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { prompt: 'select_account' }
        }
      });
      
      if (error) {
        setMessage(`Error: ${error.message}`);
        setLoading(false);
      }
      
    } catch (err) {
      setMessage(`Error: ${err.message}`);
      setLoading(false);
    }
  };
  
  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          {/* Logo */}
          <div className="login-logo">
            <img src="/electra.png" alt="Electra Scheduler" />
          </div>

          {/* Title */}
          <h1 className="login-title">Electra Scheduler</h1>
          <p className="login-subtitle">Employee Scheduling Platform</p>

          <div className="login-mode-toggle" role="group" aria-label="Login mode">
            <button
              type="button"
              className={`login-mode-button ${loginMode === 'admin' ? 'active' : ''}`}
              onClick={() => setLoginMode('admin')}
              disabled={loading}
            >
              Admin/Supervisor
            </button>
            <button
              type="button"
              className={`login-mode-button ${loginMode === 'employee' ? 'active' : ''}`}
              onClick={() => setLoginMode('employee')}
              disabled={loading}
            >
              Employee
            </button>
          </div>

          {loginMode === 'employee' && (
            <div className="login-input">
              <label htmlFor="extension">Extension</label>
              <input
                id="extension"
                type="text"
                placeholder="Enter your extension"
                value={extension}
                onChange={(e) => setExtension(e.target.value)}
                disabled={loading}
              />
              <div className={`extension-helper ${lookupStatus}`}>
                {lookupStatus === 'idle' && 'Enter your extension to verify your name.'}
                {lookupStatus === 'loading' && 'Checking extension...'}
                {lookupStatus === 'found' && employeeName && `Employee: ${employeeName}`}
                {lookupStatus === 'not_found' && 'No employee found for this extension.'}
                {lookupStatus === 'multiple' && 'Multiple employees found for this extension. Contact IT.'}
                {lookupStatus === 'error' && 'Could not verify extension. Try again.'}
              </div>
            </div>
          )}

          {/* Microsoft Login Button */}
          <div className="login-button-container">
            <button
              onClick={signInWithMicrosoft}
              disabled={loading}
              className={`microsoft-login-btn ${loading ? 'loading' : ''}`}
            >
              {loading ? (
                <>
                  <div className="login-spinner"></div>
                  <span>Connecting to Microsoft...</span>
                </>
              ) : (
                <>
                  <svg className="microsoft-icon" viewBox="0 0 21 21">
                    <path d="M1 1h9v9H1V1zM1 11h9v9H1V11zM11 1h9v9h-9V1zM11 11h9v9h-9V11z"/>
                  </svg>
                  <span>Sign in with Microsoft</span>
                </>
              )}
            </button>
          </div>

          {/* Message */}
          {message && (
            <div className="login-message">
              {message}
            </div>
          )}

          {/* Help Text */}
          <div className="login-help">
            <p>Use your company Microsoft 365 account</p>
            <p className="login-help-small">Contact IT for access issues</p>
          </div>

          {/* Footer */}
          <div className="login-footer">
            <p>© {new Date().getFullYear()} PCIS Group</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;