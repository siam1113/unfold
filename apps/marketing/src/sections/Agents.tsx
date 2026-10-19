import type React from "react";
import { Reveal } from "../components/Reveal";
import { CodeBlock } from "../components/CodeBlock";

const TRANSCRIPT = [
  { from: "user", text: "Which states show the create-project form?" },
  {
    from: "assistant",
    text: "Searching this project's evidence via MCP…",
  },
  {
    from: "assistant",
    text: "Two states in discovery #42: /projects/new and the “New project” dialog on /projects. Both have a verified locator for the submit control.",
  },
];

export function Agents() {
  return (
    <section className="section section--tint" id="agents">
      <div className="section-inner agents-grid">
        <Reveal className="agents-copy">
          <p className="section-eyebrow">For agents</p>
          <h2 className="section-title">
            Turn the map into something an agent can query
          </h2>
          <p className="section-sub">
            Every project runs its own scoped MCP server &mdash; exposing an
            overview, discovery listings, and search over state, component, and
            interaction evidence, plus a tool to start a new discovery. The
            in-app assistant uses the same tools to answer questions and draft
            Playwright tests from chat.
          </p>
          <CodeBlock
            lines={["npm run appscan -- mcp --project <project-id>"]}
          />
          <p className="agents-note">
            Serves one project over stdio, for any MCP-compatible client.
          </p>
        </Reveal>

        <Reveal delay={120} className="agent-console">
          <div className="state-card-chrome">
            <span />
            <span />
            <span />
          </div>
          <div className="console-body">
            {TRANSCRIPT.map((line, i) => (
              <div
                key={i}
                className={`console-line console-line--${line.from}`}
                style={{ "--d": `${i * 420}ms` } as React.CSSProperties}
              >
                {line.text}
              </div>
            ))}
            <div
              className="console-caret"
              style={
                { "--d": `${TRANSCRIPT.length * 420}ms` } as React.CSSProperties
              }
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
