import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import './Login.css';

const AdminLogin = () => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) window.location.href = '/schedule';
    });
  }, []);

  const signInWithMicrosoft = async () => {
    setLoading(true);
    setMessage('Redirecting to Microsoft...');
    
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