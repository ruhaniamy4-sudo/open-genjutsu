import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-row">
        <span className="brand" style={{ fontSize: 13 }}>
          <span className="brand-dot" aria-hidden="true" />
          KINETIX
        </span>
        <nav style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }} aria-label="Footer">
          <Link href="/studio">Studio</Link>
          <Link href="/playground">Playground</Link>
          <Link href="/pipeline">How it works</Link>
          <Link href="/library">Library</Link>
          <Link href="/pricing">Pricing</Link>
        </nav>
        <span className="mono" style={{ fontSize: 11 }}>© {new Date().getFullYear()} KINETIX Studio</span>
      </div>
    </footer>
  );
}
