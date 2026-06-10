import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function AppLayout() {
  const auth = useAuth();

  return (
    <div className="app-root">
      <header className="app-header">
        <NavLink className="app-brand" to="/dashboard">
          Tactical Whiteboard
        </NavLink>
        <nav className="app-nav" aria-label="Primary navigation">
          <NavLink to="/dashboard">Dashboard</NavLink>
          {auth.status === 'authenticated' ? (
            <button type="button" onClick={() => void auth.logout()}>
              Logout
            </button>
          ) : (
            <>
              <NavLink to="/login">Login</NavLink>
              <NavLink to="/register">Register</NavLink>
            </>
          )}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
