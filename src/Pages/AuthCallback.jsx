import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

const AuthCallback = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // ==================== DEBUGGING ====================
        console.log('🟡 AuthCallback: Component mounted');
        console.log('📍 Current URL:', window.location.href);
        console.log('📍 URL Hash:', window.location.hash);
        console.log('📍 URL Search:', window.location.search);
        console.log('📍 Document Referrer:', document.referrer);
        // ===================================================

        // Wait a tiny bit to ensure URL params are processed
        await new Promise(resolve => setTimeout(resolve, 100));

        // Try to get the session from the URL
        console.log('🔄 Attempting to get session from Supabase...');
        const { data, error: supabaseError } = await supabase.auth.getSession();

        if (supabaseError) {
          console.error('❌ Supabase session error:', supabaseError);
          navigate(`/login?error=${encodeURIComponent(supabaseError.message)}`);
          return;
        }

        // If no session yet, try to get it from the URL hash/query
        if (!data.session) {
          console.log('⚠️ No session from getSession, checking URL params...');
          
          // Check for tokens in URL hash (implicit flow)
          const hashParams = new URLSearchParams(window.location.hash.substring(1));
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');
          
          // Check for code in URL search (PKCE flow)
          const searchParams = new URLSearchParams(window.location.search);
          const code = searchParams.get('code');
          
          console.log('🔑 Access token in hash:', accessToken ? 'Present' : 'Missing');
          console.log('🔄 Refresh token in hash:', refreshToken ? 'Present' : 'Missing');
          console.log('🔑 Auth code in search:', code ? 'Present' : 'Missing');

          // Try to set session with tokens from hash
          if (accessToken && refreshToken) {
            console.log('🔄 Attempting to set session with tokens from hash...');
            const { data: setData, error: setError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken
            });
            
            if (setError) {
              console.error('❌ Error setting session:', setError);
            } else if (setData.session) {
              console.log('✅ Session set successfully from hash tokens!');
              data.session = setData.session;
            }
          }
          
          // Try to exchange code for session (PKCE flow)
          if (code && !data.session) {
            console.log('🔄 Attempting to exchange code for session...');
            const { data: exchangeData, error: exchangeError } = 
              await supabase.auth.exchangeCodeForSession(code);
            
            if (exchangeError) {
              console.error('❌ Code exchange error:', exchangeError);
            } else if (exchangeData.session) {
              console.log('✅ Session created from code exchange!');
              data.session = exchangeData.session;
            }
          }
        }

        // Final check for session
        if (!data.session) {
          console.error('❌ Still no session after all attempts');
          
          // One more try - maybe Supabase needs more time
          console.log('🔄 Waiting 1 second and trying one more time...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const { data: retryData } = await supabase.auth.getSession();
          if (retryData.session) {
            console.log('✅ Session found on retry!');
            data.session = retryData.session;
          } else {
            console.error('❌ No session after retry');
            console.log('🔍 Full URL debug:', {
              href: window.location.href,
              hash: window.location.hash,
              search: window.location.search,
              origin: window.location.origin,
              pathname: window.location.pathname
            });
            navigate('/login?error=no_session_created');
            return;
          }
        }

        // ==================== SUCCESS ====================
        const userEmail = data.session.user.email;
        const accessToken = data.session.access_token;

        console.log('✅✅✅ SUCCESS! Session created for:', userEmail);
        console.log('👤 User metadata:', data.session.user);

        // Store user info in localStorage
        localStorage.setItem('userEmail', userEmail);
        localStorage.setItem('userId', data.session.user.id);

        // --- Call backend to check if user is allowed ---
        const loginExtension = localStorage.getItem('loginExtension');

        try {
          console.log('🔄 Calling backend API at:', `${import.meta.env.VITE_API_URL}/api/auth/login`);
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
          console.log('📦 Backend response:', { status: res.status, ok: res.ok, json });

          if (res.ok && json.success) {
            const userRole = json.user?.role || 'employee';
            localStorage.setItem('userRole', userRole);
            localStorage.removeItem('loginExtension');
            console.log('✅ Allowed:', userEmail, 'Role:', userRole);

            // Redirect based on role
            if (userRole === 'employee') {
              console.log('➡️ Redirecting to /employee');
              navigate('/employee', { replace: true });
            } else {
              console.log('➡️ Redirecting to /schedule');
              navigate('/schedule', { replace: true });
            }
          } else {
            console.warn('❌ User not authorized:', userEmail, json.error);
            alert('You are not authorized to access this dashboard.');

            // Sign out from Supabase
            await supabase.auth.signOut();
            localStorage.removeItem('loginExtension');
            localStorage.removeItem('userRole');
            localStorage.removeItem('userEmail');
            localStorage.removeItem('userId');
            navigate('/login');
          }
        } catch (fetchError) {
          console.error('💥 Backend fetch error:', fetchError);
          // Even if backend fails, still let user in (or handle as needed)
          console.log('➡️ Backend unavailable, redirecting to schedule as fallback');
          navigate('/schedule', { replace: true });
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
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        maxWidth: '400px'
      }}>
        <div style={{
          width: '60px',
          height: '60px',
          border: '4px solid #f3f3f3',
          borderTop: '4px solid #635BFF',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 25px'
        }}></div>
        <h3 style={{ marginBottom: '10px', color: '#333' }}>Completing Microsoft login...</h3>
        <p style={{ color: '#666', fontSize: '14px' }}>Please wait while we verify your credentials.</p>
        <p style={{ color: '#999', fontSize: '12px', marginTop: '20px' }}>
          You will be redirected automatically
        </p>
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