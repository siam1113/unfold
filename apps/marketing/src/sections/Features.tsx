import {
  Network,
  Image,
  Boxes,
  MousePointer2,
  FileCode2,
  PlayCircle,
} from "lucide-react";
import { Reveal } from "../components/Reveal";

const FEATURES = [
  {
    icon: Network,
    title: "Flow explorer",
    body: "Pan, zoom, and follow discovery paths or every observed transition. Nodes are UI states, including overlays and selections — click one to inspect its evidence.",
  },
  {
    icon: Image,
    title: "States & routes",
    body: "A searchable, paginated screenshot catalog for every route and state Unfold visited, with direct, linkable URLs for each one.",
  },
  {
    icon: Boxes,
    title: "Components",
    body: "Semantic regions, repeated card and row families, nested children, and ranked locator alternatives, each with a confidence score.",
  },
  {
    icon: MousePointer2,
    title: "Interactions",
    body: "Every executed action, policy skip, and failure — with before/after images, observed side effects, and replay steps.",
  },
  {
    icon: FileCode2,
    title: "Artifacts",
    body: "Generated Playwright code, JSON exports, a standalone HTML report, and a full ZIP download of a discovery's evidence.",
  },
  {
    icon: PlayCircle,
    title: "Run controls",
    body: "Create, pause, resume, and extend a depleted budget. Pausing drains active work before recording a clean checkpoint.",
  },
];

export function Features() {
  return (
    <section className="section section--tint" id="features">
      <div className="section-inner">
        <Reveal>
          <p className="section-eyebrow">Product</p>
          <h2 className="section-title">
            Everything the browser saw, organized
          </h2>
          <p className="section-sub">
            One dashboard for every discovery &mdash; built for reading
            evidence, not guessing at it.
          </p>
        </Reveal>
        <div className="feature-grid">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <Reveal
                key={feature.title}
                delay={(i % 3) * 80}
                className="feature-card"
              >
                <div className="feature-icon">
                  <Icon size={20} strokeWidth={2} />
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
