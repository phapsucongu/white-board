import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-canvas-bg flex flex-col items-center justify-center p-4 bg-grid-pattern">
      <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-6 border border-outline-variant">
        <span className="material-symbols-outlined text-primary text-3xl">search_off</span>
      </div>
      <h1 className="text-headline-lg font-semibold text-on-surface mb-2">Page Not Found</h1>
      <p className="text-body-md text-on-surface-variant mb-8">
        The page you are looking for does not exist.
      </p>
      <Link
        to="/dashboard"
        className="bg-primary text-on-primary px-6 py-2.5 rounded text-label-mono hover:bg-primary-fixed-dim transition-colors"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
