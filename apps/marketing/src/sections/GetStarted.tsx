import { Reveal } from "../components/Reveal";
import { CodeBlock } from "../components/CodeBlock";

export function GetStarted() {
  return (
    <section className="section section--dark" id="get-started">
      <div className="section-inner get-started-inner">
        <Reveal>
          <p className="section-eyebrow">Get started</p>
          <h2 className="section-title">Map your first app in minutes</h2>
          <p className="section-sub">
            Requires Node 22.13+ and npm. Create a project for your application,
            then start a discovery inside it.
          </p>
        </Reveal>
        <Reveal delay={100} className="get-started-code">
          <CodeBlock
            lines={["npm ci", "npx playwright install chromium", "npm run dev"]}
          />
          <p className="agents-note">
            Open http://127.0.0.1:5173 once it's running.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
