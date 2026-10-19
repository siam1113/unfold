import { ShieldCheck, Lock, GitBranch } from "lucide-react";
import { Reveal } from "../components/Reveal";

const POINTS = [
  {
    icon: ShieldCheck,
    title: "Observed, not assumed",
    body: "Evidence and confidence are stored separately from inference. A guess about what a control does stays labeled as a guess until replay verifies it.",
  },
  {
    icon: GitBranch,
    title: "Verified locators",
    body: "A locator only earns that label after the engine restores the state in a real browser context and resolves it uniquely.",
  },
  {
    icon: Lock,
    title: "Redacted by default",
    body: "Screenshots mask inputs, textareas, and sensitive regions automatically. Traces keep timing but drop network payloads and action parameters.",
  },
];

export function Evidence() {
  return (
    <section className="section" id="evidence">
      <div className="section-inner evidence-grid">
        <Reveal className="evidence-copy">
          <p className="section-eyebrow">Evidence model</p>
          <h2 className="section-title">
            A claim is only as good as what backs it
          </h2>
          <p className="section-sub">
            Every node in the graph carries the proof behind it &mdash; so the
            map stays trustworthy even as the app underneath it changes.
          </p>
          <ul className="point-list">
            {POINTS.map((point) => {
              const Icon = point.icon;
              return (
                <li key={point.title}>
                  <Icon size={18} strokeWidth={2} />
                  <div>
                    <h3>{point.title}</h3>
                    <p>{point.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Reveal>

        <Reveal delay={120} className="evidence-visual">
          <div className="state-card state-card--back" aria-hidden="true" />
          <div className="state-card">
            <div className="state-card-chrome">
              <span />
              <span />
              <span />
            </div>
            <div className="state-card-body">
              <div className="skeleton-line skeleton-line--wide" />
              <div className="skeleton-line skeleton-line--mid" />
              <div className="skeleton-block" />
              <div className="skeleton-line skeleton-line--mid" />
              <div className="skeleton-line skeleton-line--narrow" />
            </div>
            <div className="state-card-footer">
              <span className="confidence-badge">Verified locator</span>
              <span className="confidence-score">0.98</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
