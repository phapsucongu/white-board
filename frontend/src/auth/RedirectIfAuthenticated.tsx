import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RedirectIfAuthenticated() {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return <p className="muted">Checking session...</p>;
  }

  if (auth.status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
