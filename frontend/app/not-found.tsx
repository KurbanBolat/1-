import Link from "next/link";

export default function NotFound() {
  return (
    <div className="layout">
      <section className="not-found-shell">
        <p className="kicker">StayPilot</p>
        <h1>404</h1>
        <p>Page not found. The link may be outdated or the listing was removed.</p>
        <div className="not-found-actions">
          <Link href="/" className="ghost-btn">
            Back to search
          </Link>
          <Link href="/?lang=ru&currency=KZT" className="ghost-btn">
            Search (RU)
          </Link>
        </div>
      </section>
    </div>
  );
}
