import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import AuthWrapper from './components/AuthWrapper';  
import Layout from './components/layout/Layout';
import Employees from './Pages/Employees';
import Schedule from './Pages/Schedule';
import Analytics from './Pages/Analytics';
import StatusPage from './Pages/Status';
import Login from './components/Login';
import AuthCallback from './Pages/AuthCallback';
import LogsPage from './Pages/Logs';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        {/* Public route - Login page */}
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        
        {/* Protected routes - Wrapped with authentication */}
        <Route element={<AuthWrapper />}>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/schedule" replace />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="employees" element={<Employees />} />
            <Route path="status" element={<StatusPage />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="logs" element={<LogsPage />} />
          </Route>
        </Route>
        
        {/* Redirect any unknown route to login */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;