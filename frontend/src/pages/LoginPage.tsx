import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { login, error, clearError } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const from = searchParams.get('from') ?? '/dashboard';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearError();
    setSubmitting(true);

    try {
      await login({ email, password });
      navigate(from === '/login' ? '/dashboard' : from, { replace: true });
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas-bg flex items-center justify-center p-4 relative overflow-hidden bg-grid-pattern antialiased">
      {/* Subtle background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary-container/5 via-transparent to-canvas-bg z-0 pointer-events-none" />

      <main className="w-full max-w-md bg-surface-dim rounded border border-stroke-default shadow-[20px_0_40px_rgba(0,0,0,0.5)] relative z-10 overflow-hidden">
        {/* Top accent line */}
        <div className="h-1 w-full bg-primary absolute top-0 left-0" />
        <div className="p-8">
          {/* Header */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-10 h-10 rounded bg-surface-container flex items-center justify-center mb-4 border border-outline-variant shadow-[0_0_15px_rgba(142,213,255,0.1)]">
              <span
                className="material-symbols-outlined text-primary text-xl"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                draw
              </span>
            </div>
            <h1 className="text-headline-lg font-semibold text-on-surface text-center tracking-tight">
              CanvasFlow
            </h1>
            <p className="text-body-md text-on-surface-variant text-center mt-1">
              Sign in to your workspace
            </p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                className="block text-label-mono text-on-surface-variant mb-1.5 uppercase tracking-wider"
                htmlFor="email"
              >
                Email Address
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-on-surface-variant/50">
                  <span className="material-symbols-outlined text-lg">mail</span>
                </span>
                <input
                  className="w-full bg-surface-container border border-outline-variant rounded pl-10 pr-4 py-2.5 text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                  id="email"
                  name="email"
                  type="email"
                  placeholder="user@domain.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label
                className="block text-label-mono text-on-surface-variant mb-1.5 uppercase tracking-wider"
                htmlFor="password"
              >
                Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-on-surface-variant/50">
                  <span className="material-symbols-outlined text-lg">lock</span>
                </span>
                <input
                  className="w-full bg-surface-container border border-outline-variant rounded pl-10 pr-4 py-2.5 text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                  id="password"
                  name="password"
                  type="password"
                  placeholder="••••••••"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <p className="text-error text-body-sm bg-error/10 border border-error/20 rounded p-3">
                {error}
              </p>
            )}

            <button
              className="w-full h-[40px] bg-primary text-on-primary rounded text-body-md font-semibold hover:bg-primary-fixed hover:shadow-[0_0_20px_rgba(142,213,255,0.4)] transition-all duration-200 flex items-center justify-center gap-2 active:scale-[0.98] mt-6 disabled:opacity-50"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Signing in...' : 'Login to Workspace'}
            </button>
          </form>

          {/* Register Link */}
          <div className="mt-8 text-center">
            <p className="text-body-sm text-on-surface-variant">
              Don&apos;t have an account?{' '}
              <Link
                to="/register"
                className="text-primary hover:text-primary-fixed transition-colors"
              >
                Initialize workspace
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
