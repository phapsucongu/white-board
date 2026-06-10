import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">404</p>
        <h1>Page Not Found</h1>
      </div>
      <p className="muted">The requested route does not exist.</p>
      <Link className="button-link" to="/dashboard">
        Go to Dashboard
      </Link>
    </section>
  );
}
