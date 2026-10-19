function Logo() {
  return (
    <a href="#top" className="logo">
      <svg
        viewBox="0 0 64 64"
        fill="none"
        className="logo-mark"
        aria-hidden="true"
      >
        <rect width="64" height="64" rx="16" fill="#172638" />
        <path
          d="m13 23 19-10 19 10-19 10-19-10Z"
          stroke="#42D4BD"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path
          d="m13 33 19 10 19-10M13 43l19 10 19-10"
          stroke="#42D4BD"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>Unfold</span>
    </a>
  );
}

export function Nav() {
  return (
    <header className="nav">
      <div className="nav-inner">
        <Logo />
        <nav className="nav-links" aria-label="Primary">
          <a href="#how-it-works">How it works</a>
          <a href="#features">Product</a>
          <a href="#agents">For agents</a>
        </nav>
        <a href="#get-started" className="button button--primary nav-cta">
          Get started
        </a>
      </div>
    </header>
  );
}
