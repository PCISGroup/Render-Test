import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

const AuthCallback = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        console.log('🟡 AuthCallback: Processing OAuth response...');

        // Get Supabase session after OAuth redirect
        const { data, error: supabaseError } = await supabase.auth.getSession();

        if (supabaseError) {
          console.error('❌ Supabase session error:', supabaseError);
          navigate(`/login?error=${encodeURIComponent(supabaseError.message)}`);
          return;
        }

        if (!data.session) {
          console.warn('⚠️ No session created after OAuth callback');
          navigate('/login?error=no_session_created');
          return;
        }

        const userEmail = data.session.user.email;
        const accessToken = data.session.access_token;

        console.log('✅ Supabase session user:', userEmail);

        // --- Call backend to check if user is allowed ---
        const loginExtension = localStorage.getItem('loginExtension');

        const res = await fetch(
          `${import.meta.env.VITE_API_URL}/api/auth/login`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              access_token: accessToken,
              extension: loginExtension || undefined
            })
          }
        );

        const json = await res.json().catch(() => ({}));

        if (res.ok && json.success) {
          const userRole = json.user?.role || 'employee';
          localStorage.setItem('userRole', userRole);
          localStorage.removeItem('loginExtension');
          console.log('✅ Allowed:', userEmail, 'Role:', userRole);

          if (userRole === 'employee') {
            navigate('/employee', { replace: true });
          } else {
            navigate('/schedule', { replace: true });
          }
        } else {
          console.warn('❌ Admin not allowed:', userEmail, json.error);
          alert('You are not authorized to access this dashboard.');

          // Sign out from Supabase to prevent session reuse
          await supabase.auth.signOut();
          localStorage.removeItem('loginExtension');
          localStorage.removeItem('userRole');
          navigate('/login');
        }

      } catch (err) {
        console.error('💥 Unexpected error in callback:', err);
        alert('Login failed. Please try again.');
        navigate('/login');
      }
    };

    handleAuthCallback();
  }, [navigate]);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      backgroundColor: '#f5f5f5'
    }}>
      <div style={{
        textAlign: 'center',
        padding: '40px',
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
      }}>
        <div style={{
          width: '50px',
          height: '50px',
          border: '3px solid #f3f3f3',
          borderTop: '3px solid #635BFF',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 20px'
        }}></div>
        <h3>Completing Microsoft login...</h3>
        <p>Please wait while we redirect you.</p>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
};

export default AuthCallback;
