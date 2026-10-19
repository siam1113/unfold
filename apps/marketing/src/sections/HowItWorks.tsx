import { Globe, ScanSearch, Network, Terminal } from "lucide-react";
import { Reveal } from "../components/Reveal";

const STEPS = [
  {
    icon: Globe,
    title: "Point it at your app",
    body: "Create a project with your application's URL and scan settings. Each project keeps its own discovery history, MCP endpoint, and assistant instructions.",
  },
  {
    icon: ScanSearch,
    title: "It explores live, safely",
    body: "A real Chromium browser restores states, activates permitted controls, and records what happens. Unknown controls are skipped in safe mode; mutations need explicit allowlists.",
  },
  {
    icon: Network,
    title: "Evidence becomes a map",
    body: "States, routes, components, and transitions turn into a searchable graph — with screenshots, verified locators, and observed effects attached to every node.",
  },
  {
    icon: Terminal,
    title: "Query it, replay it, extend it",
    body: "Explore the flow graph in the dashboard, export reusable Playwright code and reports, or connect an agent through the project's MCP endpoint.",
  },
];

export function HowItWorks() {
  return (
    <section className="section" id="how-it-works">
      <div className="section-inner">
        <Reveal>
          <p className="section-eyebrow">How it works</p>
          <h2 className="section-title">From a URL to verified evidence</h2>
        </Reveal>
        <ol className="steps">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <Reveal as="li" key={step.title} delay={i * 90} className="step">
                <div className="step-marker">
                  <Icon size={18} strokeWidth={2} />
                  <span className="step-index">{i + 1}</span>
                </div>
                <div className="step-body">
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </Reveal>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
