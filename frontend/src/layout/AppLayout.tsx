import { Outlet } from 'react-router-dom';
import { AppHeader } from '../components/layout/app-header';
import { MobileNav } from '../components/layout/mobile-nav';

export function AppLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-on-surface">
      <AppHeader />
      <main className="flex-1 pb-12 md:pb-0">
        <Outlet />
      </main>
      <MobileNav />
    </div>
  );
}
