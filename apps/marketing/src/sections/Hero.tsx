import type React from "react";
import { FlowGraphAnimation } from "../components/FlowGraphAnimation";

export function Hero() {
  return (
    <section className="hero" id="top">
      <div className="aurora" aria-hidden="true" />
      <div className="hero-inner">
        <div className="hero-copy">
          <p
            className="eyebrow hero-animate"
            style={{ "--d": "0ms" } as React.CSSProperties}
          >
            Live application discovery
          </p>
          <h1
            className="hero-animate"
            style={{ "--d": "60ms" } as React.CSSProperties}
          >
            See what your app{" "}
            <span className="accent-text">actually does.</span>
          </h1>
          <p
            className="hero-sub hero-animate"
            style={{ "--d": "140ms" } as React.CSSProperties}
          >
            Unfold opens a real browser, explores your app the way a person
            would, and turns every screen, route, and interaction into an
            evidence-backed map &mdash; one that people, tests, and AI agents
            can all trust.
          </p>
          <div
            className="hero-actions hero-animate"
            style={{ "--d": "220ms" } as React.CSSProperties}
          >
            <a href="#get-started" className="button button--primary">
              Get started
            </a>
            <a href="#how-it-works" className="button button--ghost">
              See how it works
            </a>
          </div>
          <p
            className="hero-note hero-animate"
            style={{ "--d": "280ms" } as React.CSSProperties}
          >
            Open source &middot; runs against your own application &middot; safe
            by default
          </p>
        </div>
        <div
          className="hero-visual hero-animate"
          style={{ "--d": "180ms" } as React.CSSProperties}
        >
          <FlowGraphAnimation />
        </div>
      </div>
    </section>
  );
}
