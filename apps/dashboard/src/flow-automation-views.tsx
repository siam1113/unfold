import { useRef, useState } from "react";
import { Workflow, FolderCode, Maximize2, Minimize2 } from "lucide-react";
import { AutomationWorkflowViews } from "./flow-automation-workflow-views";
import { AutomationFrameworkViews } from "./flow-automation-framework-views";
import { useFullscreenToggle } from "./use-fullscreen";
import "./flow-automation-views.css";

// Automation page: /projects/:projectId/automation. Two independent tabs —
// Workflow (a named step sequence + expected outcome, run against the
// project's app) and Framework (a real Cypress/Playwright project edited
// in-browser and executed server-side). See
// apps/server/src/automation-workflows.ts and automation-framework.ts for
// the API surface each tab talks to.
type AutomationTab = "workflow" | "framework";

export function AutomationPage({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<AutomationTab>("workflow");
  // Fullscreen targets only the active tab's content panel (a descendant of
  // this ref), not the page heading or tab switcher — the native Fullscreen
  // API hides everything outside the target element, so putting the ref
  // here rather than on <main> is what keeps the focus scoped to "just this
  // tab" instead of the whole page.
  const panelRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggleFullscreen } = useFullscreenToggle(panelRef);
  // A slot on the tabs row that the active tab can render into (via a
  // portal) — e.g. the Framework tab's package-manager picker and Execute
  // button live here rather than buried in its own content, since they're
  // relevant regardless of what's scrolled into view below.
  const [tabActionsEl, setTabActionsEl] = useState<HTMLDivElement | null>(
    null,
  );
  return (
    <main className="automation-page run-page">
      <div className="page-heading">
        <div>
          <h1>Automation</h1>
          <p>
            Build repeatable workflows and run a real test-automation
            framework against this project.
          </p>
        </div>
      </div>
      <nav className="automation-tabs" role="tablist" aria-label="Automation">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "workflow"}
          className={tab === "workflow" ? "active" : ""}
          onClick={() => setTab("workflow")}
        >
          <Workflow size={15} />
          Workflow
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "framework"}
          className={tab === "framework" ? "active" : ""}
          onClick={() => setTab("framework")}
        >
          <FolderCode size={15} />
          Framework
        </button>
        <div className="automation-tab-actions" ref={setTabActionsEl} />
        <button
          type="button"
          className="icon-button automation-fullscreen-toggle"
          aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
          title={isFullscreen ? "Exit full screen" : "Full screen"}
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </nav>
      <div
        ref={panelRef}
        className={`automation-tab-panel${isFullscreen ? " is-fullscreen" : ""}`}
      >
        {tab === "workflow" ? (
          <AutomationWorkflowViews projectId={projectId} />
        ) : (
          <AutomationFrameworkViews
            projectId={projectId}
            tabActionsContainer={tabActionsEl}
          />
        )}
      </div>
    </main>
  );
}
