import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

export function MobileNav() {
  const { status, logout } = useAuth();
  const location = useLocation();

  if (status !== 'authenticated') return null;

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 h-12 md:hidden bg-surface-container/80 backdrop-blur-md border-t border-stroke-default shadow-lg">
      <Link
        to="/dashboard"
        className={`flex flex-col items-center gap-0.5 transition-colors ${
          isActive('/dashboard') ? 'text-primary' : 'text-on-surface-variant hover:text-primary'
        }`}
      >
        <span
          className="material-symbols-outlined text-[20px]"
          style={
            isActive('/dashboard')
              ? { fontVariationSettings: "'FILL' 1" }
              : undefined
          }
        >
          dashboard
        </span>
        <span className="text-[10px] leading-none font-label-code">Dashboard</span>
      </Link>
      <button
        onClick={() => logout()}
        className="flex flex-col items-center gap-0.5 text-on-surface-variant hover:text-primary transition-colors"
        type="button"
      >
        <span className="material-symbols-outlined text-[20px]">logout</span>
        <span className="text-[10px] leading-none font-label-code">Logout</span>
      </button>
    </nav>
  );
}
