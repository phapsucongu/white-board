import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function RegisterPage() {
  const { register, error, clearError } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const displayError = localError ?? error;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearError();
    setLocalError(null);

    if (password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters');
      return;
    }

    setSubmitting(true);

    try {
      await register({ email, password, displayName: displayName || undefined });
      navigate('/dashboard', { replace: true });
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas-bg flex items-center justify-center p-6 bg-grid-pattern antialiased">
      {/* Registration Card */}
      <div className="w-full max-w-[480px] bg-surface-container border border-outline-variant/30 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden relative">
        {/* Subtle Glow Effect */}
        <div className="absolute -top-[50%] -left-[50%] w-[200%] h-[200%] bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.05)_0%,transparent_50%)] pointer-events-none" />
        <div className="relative z-10 p-8 sm:p-12">
          {/* Brand Header */}
          <Link
            to="/login"
            className="flex items-center gap-3 mb-10 group/logo"
          >
            <div className="w-8 h-8 rounded bg-primary-container flex items-center justify-center shadow-[0_0_15px_rgba(56,189,248,0.3)] transition-transform group-hover/logo:scale-105">
              <span
                className="material-symbols-outlined text-on-primary-container text-xl"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                architecture
              </span>
            </div>
            <span className="text-headline-lg font-semibold text-primary-container tracking-tight">
              CanvasFlow
            </span>
          </Link>

          {/* Form Title */}
          <h1 className="text-headline-lg font-semibold mb-2">Initialize Workspace</h1>
          <p className="text-body-md text-on-surface-variant mb-8">
            Deploy your account to join real-time collaboration sessions.
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Full Name Field */}
            <div>
              <label
                className="block text-label-mono text-on-surface-variant mb-2 uppercase tracking-wider"
                htmlFor="displayName"
              >
                Full Name
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-lg">
                  person
                </span>
                <input
                  className="w-full bg-surface-container-high/50 border border-outline-variant/50 rounded pl-10 pr-4 py-2.5 text-body-md text-on-surface placeholder:text-outline/50 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container/50 transition-all"
                  id="displayName"
                  type="text"
                  placeholder="Jane Doe"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            </div>

            {/* Email Field */}
            <div>
              <label
                className="block text-label-mono text-on-surface-variant mb-2 uppercase tracking-wider"
                htmlFor="email"
              >
                Email Address
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-lg">
                  mail
                </span>
                <input
                  className="w-full bg-surface-container-high/50 border border-outline-variant/50 rounded pl-10 pr-4 py-2.5 text-body-md text-on-surface placeholder:text-outline/50 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container/50 transition-all"
                  id="email"
                  type="email"
                  placeholder="agent@canvasflow.io"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            {/* Password Fields Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  className="block text-label-mono text-on-surface-variant mb-2 uppercase tracking-wider"
                  htmlFor="password"
                >
                  Password
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-lg">
                    lock
                  </span>
                  <input
                    className="w-full bg-surface-container-high/50 border border-outline-variant/50 rounded pl-10 pr-4 py-2.5 text-body-md text-on-surface placeholder:text-outline/50 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container/50 transition-all"
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label
                  className="block text-label-mono text-on-surface-variant mb-2 uppercase tracking-wider"
                  htmlFor="confirmPassword"
                >
                  Confirm
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-lg">
                    verified_user
                  </span>
                  <input
                    className="w-full bg-surface-container-high/50 border border-outline-variant/50 rounded pl-10 pr-4 py-2.5 text-body-md text-on-surface placeholder:text-outline/50 focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container/50 transition-all"
                    id="confirmPassword"
                    type="password"
                    placeholder="••••••••"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {displayError && (
              <p className="text-error text-body-sm bg-error/10 border border-error/20 rounded p-3">
                {displayError}
              </p>
            )}

            {/* Submit */}
            <button
              className="w-full h-11 bg-primary-container text-on-primary-container rounded text-body-md font-semibold hover:bg-primary hover:shadow-[0_0_20px_rgba(56,189,248,0.4)] transition-all duration-200 flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Deploying...' : 'Deploy Account'}
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>
          </form>

          {/* Login Link */}
          <div className="mt-10 pt-6 border-t border-outline-variant/20 text-center">
            <p className="text-body-sm text-on-surface-variant">
              Session already initialized?{' '}
              <Link
                to="/login"
                className="text-primary-container font-semibold hover:text-primary transition-colors ml-1"
              >
                Authenticate here
              </Link>
            </p>
          </div>
        </div>
        {/* Decorative Corner */}
        <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none overflow-hidden">
          <div className="absolute top-0 right-0 w-[2px] h-8 bg-primary-container/30" />
          <div className="absolute top-0 right-0 w-8 h-[2px] bg-primary-container/30" />
        </div>
      </div>
    </div>
  );
}
