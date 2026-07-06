import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

type AppHeaderProps = {
  showNav?: boolean;
};

export function AppHeader({ showNav = true }: AppHeaderProps) {
  const { logout, user, status } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="hidden md:flex flex-col w-full sticky top-0 z-50 bg-surface-dim/80 backdrop-blur-md border-b border-stroke-default">
      <div className="flex justify-between items-center w-full px-6 h-12">
        <div className="flex items-center gap-6">
          <Link
            to="/dashboard"
            className="text-headline-md font-semibold text-primary tracking-tight"
          >
            CanvasFlow
          </Link>
          {showNav && status === 'authenticated' && (
            <nav className="flex items-center gap-6 h-full">
              <Link
                to="/dashboard"
                className="h-full flex items-center text-primary border-b-2 border-primary transition-colors px-2"
              >
                Dashboard
              </Link>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-4">
          {status === 'authenticated' ? (
            <>
              <div className="flex items-center gap-2 text-on-surface-variant">
                <button
                  className="hover:text-primary transition-colors p-1"
                  aria-label="Profile"
                  onClick={() => navigate('/dashboard')}
                >
                  <span className="material-symbols-outlined">account_circle</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-primary/10 border border-outline-variant flex items-center justify-center text-primary text-label-mono font-medium">
                  {(user?.displayName || user?.email || 'U').charAt(0).toUpperCase()}
                </span>
                <button
                  className="text-body-sm text-on-surface-variant hover:text-on-surface transition-colors"
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Link
                to="/login"
                className="text-body-sm text-on-surface-variant hover:text-on-surface transition-colors"
              >
                Sign In
              </Link>
              <Link
                to="/register"
                className="bg-primary text-on-primary px-4 py-1.5 rounded text-label-mono hover:bg-primary-fixed-dim transition-colors"
              >
                Register
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
