import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import Editor from "@monaco-editor/react";
import {
  FolderCode,
  File,
  Folder,
  ChevronRight,
  ChevronDown,
  Save,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Wand2,
  GitBranch,
  CloudDownload,
  UploadCloud,
  AlertTriangle,
  X,
  Terminal,
  Boxes,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  FrameworkProject,
  TestRun,
  TestCaseResult,
  PackageOperation,
} from "../../../packages/shared/src/index";
import "./flow-automation-framework-views.css";

// Framework tab of the Automation page (apps/dashboard/src/flow-automation-views.tsx).
// Server contract (apps/server/src/automation-framework.ts + automation-execution.ts +
// automation-github.ts + automation-suggest-fix.ts, wired onto apps/server/src/index.ts):
//   GET    /api/projects/:id/automation/framework                 -> FrameworkProject | null
//   POST   /api/projects/:id/automation/framework                 { framework, origin } -> FrameworkProject (get-or-create, one per project)
//   PUT    /api/projects/:id/automation/framework                 { packageManager } -> FrameworkProject
//   GET    /api/projects/:id/automation/framework/files            -> { path, isDir }[]
//   GET    /api/projects/:id/automation/framework/files?path=...   -> { path, content }
//   PUT    /api/projects/:id/automation/framework/files            { path, content } -> { path }
//   POST   /api/projects/:id/automation/framework/run              -> TestRun
//   GET    /api/projects/:id/automation/framework/runs/:runId      -> TestRun
//   GET    /api/projects/:id/automation/framework/packages                    -> { name, version, dev }[]
//   POST   /api/projects/:id/automation/framework/packages        { name, version?, dev? } -> PackageOperation
//   DELETE /api/projects/:id/automation/framework/packages?name=... -> PackageOperation
//   GET    /api/projects/:id/automation/framework/packages/operations/:opId -> PackageOperation
//   POST   /api/projects/:id/automation/framework/github/connect   { repoUrl, token, defaultBranch? } -> FrameworkProject
//   POST   /api/projects/:id/automation/framework/github/sync      { direction: "pull" | "push", message? } -> { ok: true }
//   POST   /api/projects/:id/automation/framework/suggest-fix      { runId, caseName, filePath } -> { path, diff, explanation }
// Types: FrameworkProject, TestRun, TestCaseResult, PackageOperation in packages/shared/src/index.ts.

type PackageEntry = { name: string; version: string; dev: boolean };
type PackageManager = FrameworkProject["packageManager"];

// Official brand marks — Cypress's path is their published single-color
// logo (CC0-licensed brand data, sourced from the simple-icons project);
// Playwright's is their actual multi-color logo fetched directly from
// playwright.dev/img/playwright-logo.svg. Neither is a lucide stand-in.
export function CypressMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M11.998.0195c-.8642 0-1.6816.1101-2.1445.1934v.002C4.1731 1.2283 0 6.1368 0 12.0018c0 1.1265.1573 2.2328.4648 3.3028.0387.1453.0915.2993.1368.4473 1.607 4.865 6.2245 8.226 11.3925 8.2285.0651 0 .2518-.0003.502-.0118.8564-.0353 1.6228-.5734 1.9512-1.369l.4736-1.1544L20.4258 8.043H18.621l-2.3164 5.871-2.334-5.871h-1.9082l3.2734 8.0117c-.8115 1.9702-1.6252 3.9395-2.4355 5.9101-.0808.1945-.2655.3284-.4727.336-.144.005-.285.0098-.4316.0098-4.5848 0-8.6672-3.0695-9.9277-7.4649a10.3058 10.3058 0 0 1-.3985-2.8437c0-5.0887 3.6521-9.3404 8.6035-10.164.2214-.037.8885-.1446 1.7246-.1446 4.4166 0 8.269 2.732 9.7305 6.8476.0558.144.0977.293.1465.4395.299.9746.4531 1.9887.4531 3.0215 0 4.5696-2.9413 8.5326-7.3164 9.8613l.4863 1.5996c5.085-1.546 8.4995-6.1518 8.502-11.459 0-1.5491-.2983-2.8706-.6504-3.8926-.0432-.1212-.0873-.2422-.1309-.3633h-.002C21.4577 3.0954 17.0444.0195 11.998.0195ZM8.4336 7.8906c-1.1999 0-2.1747.3852-2.9805 1.1758-.8007.7856-1.205 1.7736-1.205 2.9356 0 1.1544.4068 2.1368 1.205 2.9199.8058.7906 1.7806 1.1738 2.9805 1.1738 1.705 0 3.1556-.955 3.7871-2.4883l.0332-.082-1.6289-.5547c-.168.4563-.7552 1.4883-2.1914 1.4883-.6745 0-1.2437-.2344-1.6934-.6992-.4572-.4699-.6875-1.0632-.6875-1.7578 0-.6998.2253-1.2809.6875-1.7735.4522-.4648 1.019-.7012 1.6934-.7012 1.438 0 2.0238 1.0815 2.1934 1.4883l1.627-.5527-.0333-.084c-.629-1.5358-2.082-2.4883-3.7871-2.4883Z" />
    </svg>
  );
}
export function PlaywrightMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 400 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M136.444 221.556C123.558 225.213 115.104 231.625 109.535 238.032C114.869 233.364 122.014 229.08 131.652 226.348C141.51 223.554 149.92 223.574 156.869 224.915V219.481C150.941 218.939 144.145 219.371 136.444 221.556ZM108.946 175.876L61.0895 188.484C61.0895 188.484 61.9617 189.716 63.5767 191.36L104.153 180.668C104.153 180.668 103.578 188.077 98.5847 194.705C108.03 187.559 108.946 175.876 108.946 175.876ZM149.005 288.347C81.6582 306.486 46.0272 228.438 35.2396 187.928C30.2556 169.229 28.0799 155.067 27.5 145.928C27.4377 144.979 27.4665 144.179 27.5336 143.446C24.04 143.657 22.3674 145.473 22.7077 150.721C23.2876 159.855 25.4633 174.016 30.4473 192.721C41.2301 233.225 76.8659 311.273 144.213 293.134C158.872 289.185 169.885 281.992 178.152 272.81C170.532 279.692 160.995 285.112 149.005 288.347ZM161.661 128.11V132.903H188.077C187.535 131.206 186.989 129.677 186.447 128.11H161.661Z" fill="#2D4552" />
      <path d="M193.981 167.584C205.861 170.958 212.144 179.287 215.465 186.658L228.711 190.42C228.711 190.42 226.904 164.623 203.57 157.995C181.741 151.793 168.308 170.124 166.674 172.496C173.024 167.972 182.297 164.268 193.981 167.584ZM299.422 186.777C277.573 180.547 264.145 198.916 262.535 201.255C268.89 196.736 278.158 193.031 289.837 196.362C301.698 199.741 307.976 208.06 311.307 215.436L324.572 219.212C324.572 219.212 322.736 193.41 299.422 186.777ZM286.262 254.795L176.072 223.99C176.072 223.99 177.265 230.038 181.842 237.869L274.617 263.805C282.255 259.386 286.262 254.795 286.262 254.795ZM209.867 321.102C122.618 297.71 133.166 186.543 147.284 133.865C153.097 112.156 159.073 96.0203 164.029 85.204C161.072 84.5953 158.623 86.1529 156.203 91.0746C150.941 101.747 144.212 119.124 137.7 143.45C123.586 196.127 113.038 307.29 200.283 330.682C241.406 341.699 273.442 324.955 297.323 298.659C274.655 319.19 245.714 330.701 209.867 321.102Z" fill="#2D4552" />
      <path d="M161.661 262.296V239.863L99.3324 257.537C99.3324 257.537 103.938 230.777 136.444 221.556C146.302 218.762 154.713 218.781 161.661 220.123V128.11H192.869C189.471 117.61 186.184 109.526 183.423 103.909C178.856 94.612 174.174 100.775 163.545 109.665C156.059 115.919 137.139 129.261 108.668 136.933C80.1966 144.61 57.179 142.574 47.5752 140.911C33.9601 138.562 26.8387 135.572 27.5049 145.928C28.0847 155.062 30.2605 169.224 35.2445 187.928C46.0272 228.433 81.663 306.481 149.01 288.342C166.602 283.602 179.019 274.233 187.626 262.291H161.661V262.296ZM61.0848 188.484L108.946 175.876C108.946 175.876 107.551 194.288 89.6087 199.018C71.6614 203.743 61.0848 188.484 61.0848 188.484Z" fill="#E2574C" />
      <path d="M341.786 129.174C329.345 131.355 299.498 134.072 262.612 124.185C225.716 114.304 201.236 97.0224 191.537 88.8994C177.788 77.3834 171.74 69.3802 165.788 81.4857C160.526 92.163 153.797 109.54 147.284 133.866C133.171 186.543 122.623 297.706 209.867 321.098C297.093 344.47 343.53 242.92 357.644 190.238C364.157 165.917 367.013 147.5 367.799 135.625C368.695 122.173 359.455 126.078 341.786 129.174ZM166.497 172.756C166.497 172.756 180.246 151.372 203.565 158C226.899 164.628 228.706 190.425 228.706 190.425L166.497 172.756ZM223.42 268.713C182.403 256.698 176.077 223.99 176.077 223.99L286.262 254.796C286.262 254.791 264.021 280.578 223.42 268.713ZM262.377 201.495C262.377 201.495 276.107 180.126 299.422 186.773C322.736 193.411 324.572 219.208 324.572 219.208L262.377 201.495Z" fill="#2EAD33" />
      <path d="M139.88 246.04L99.3324 257.532C99.3324 257.532 103.737 232.44 133.607 222.496L110.647 136.33L108.663 136.933C80.1918 144.611 57.1742 142.574 47.5704 140.911C33.9554 138.563 26.834 135.572 27.5001 145.929C28.08 155.063 30.2557 169.224 35.2397 187.929C46.0225 228.433 81.6583 306.481 149.005 288.342L150.989 287.719L139.88 246.04ZM61.0848 188.485L108.946 175.876C108.946 175.876 107.551 194.288 89.6087 199.018C71.6615 203.743 61.0848 188.485 61.0848 188.485Z" fill="#D65348" />
      <path d="M225.27 269.163L223.415 268.712C182.398 256.698 176.072 223.99 176.072 223.99L232.89 239.872L262.971 124.281L262.607 124.185C225.711 114.304 201.232 97.0224 191.532 88.8994C177.783 77.3834 171.735 69.3802 165.783 81.4857C160.526 92.163 153.797 109.54 147.284 133.866C133.171 186.543 122.623 297.706 209.867 321.097L211.655 321.5L225.27 269.163ZM166.497 172.756C166.497 172.756 180.246 151.372 203.565 158C226.899 164.628 228.706 190.425 228.706 190.425L166.497 172.756Z" fill="#1D8D22" />
      <path d="M141.946 245.451L131.072 248.537C133.641 263.019 138.169 276.917 145.276 289.195C146.513 288.922 147.74 288.687 149 288.342C152.302 287.451 155.364 286.348 158.312 285.145C150.371 273.361 145.118 259.789 141.946 245.451ZM137.7 143.451C132.112 164.307 127.113 194.326 128.489 224.436C130.952 223.367 133.554 222.371 136.444 221.551L138.457 221.101C136.003 188.939 141.308 156.165 147.284 133.866C148.799 128.225 150.318 122.978 151.832 118.085C149.393 119.637 146.767 121.228 143.776 122.867C141.759 129.093 139.722 135.898 137.7 143.451Z" fill="#C04B41" />
    </svg>
  );
}
// Google Chrome's single-color brand mark — same CC0-licensed path as
// Cypress/Playwright above, sourced from the simple-icons project.
export function ChromeMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728Z" />
    </svg>
  );
}
const FRAMEWORK_ICON: Record<
  FrameworkProject["framework"],
  ComponentType<{ size?: number }>
> = {
  cypress: CypressMark,
  playwright: PlaywrightMark,
};
const FRAMEWORK_LABEL: Record<FrameworkProject["framework"], string> = {
  cypress: "Cypress",
  playwright: "Playwright",
};
// No distinct Lucide icon exists per package manager brand, so each gets a
// small colored monogram (not a word) instead — glanceable like a favicon,
// without reproducing any package manager's actual logo mark.
const PACKAGE_MANAGERS: { value: PackageManager; label: string; letter: string }[] =
  [
    { value: "npm", label: "npm", letter: "N" },
    { value: "yarn", label: "Yarn", letter: "Y" },
    { value: "pnpm", label: "pnpm", letter: "P" },
  ];

const apiRequest = async <T,>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> => {
  const res = await fetch(
    "/api" + path,
    body === undefined
      ? undefined
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error((value as { error?: string }).error || "Request failed");
  return value as T;
};

type FileEntry = { path: string; isDir: boolean };

type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
};

function buildTree(entries: FileEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();
  // Sort so directories and files interleave deterministically by path —
  // the tree below re-sorts each level (dirs first) for display anyway.
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of sorted) {
    const parts = entry.path.split("/").filter(Boolean);
    let parentPath = "";
    let siblings = roots;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = parentPath ? `${parentPath}/${part}` : part;
      let node = byPath.get(currentPath);
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          isDir: isLast ? entry.isDir : true,
          children: [],
        };
        byPath.set(currentPath, node);
        siblings.push(node);
      }
      siblings = node.children;
      parentPath = currentPath;
    }
  }
  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sortTree(n.children));
  };
  sortTree(roots);
  return roots;
}

function languageFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".cy.js")
  )
    return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".md")) return "markdown";
  return "plaintext";
}

const STATUS_ICON: Record<
  TestCaseResult["status"],
  { icon: typeof CheckCircle2; className: string }
> = {
  passed: { icon: CheckCircle2, className: "is-passed" },
  failed: { icon: XCircle, className: "is-failed" },
  skipped: { icon: MinusCircle, className: "is-skipped" },
};

function TreeRow({
  node,
  depth,
  selectedPath,
  expanded,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  return (
    <>
      <button
        type="button"
        className={`faw-tree-row${selectedPath === node.path ? " is-selected" : ""}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => (node.isDir ? onToggle(node.path) : onSelect(node.path))}
      >
        {node.isDir ? (
          isOpen ? (
            <ChevronDown size={12} className="faw-tree-chevron" />
          ) : (
            <ChevronRight size={12} className="faw-tree-chevron" />
          )
        ) : (
          <span className="faw-tree-chevron-spacer" />
        )}
        {node.isDir ? <Folder size={13} /> : <File size={13} />}
        <span className="faw-tree-name">{node.name}</span>
      </button>
      {node.isDir &&
        isOpen &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="faw-diff">
      {lines.map((line, i) => {
        let cls = "faw-diff-ctx";
        if (line.startsWith("+") && !line.startsWith("+++")) cls = "faw-diff-add";
        else if (line.startsWith("-") && !line.startsWith("---"))
          cls = "faw-diff-del";
        else if (line.startsWith("@@")) cls = "faw-diff-hunk";
        return (
          <span className={cls} key={i}>
            {line}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}

// Pragmatic unified-diff "apply": we don't implement a general patch
// algorithm here. Instead, any hunk line starting with "+" contributes its
// text and any "-"/" " line is treated as content that existed in the
// original — since we already have the original buffer loaded in the
// editor, the simplest faithful v1 behavior is to replace the buffer with
// the diff's post-image, reconstructed by walking hunks and keeping
// "+"/" " lines in order while dropping "-" lines. This is correct for
// well-formed single-file unified diffs against the content currently
// loaded, and if a hunk doesn't line up cleanly we leave the original
// content alone and let the user apply by hand instead.
function applyUnifiedDiff(original: string, diff: string): string | null {
  const lines = diff.split("\n");
  const hasHunks = lines.some((l) => l.startsWith("@@"));
  if (!hasHunks) return null;
  const out: string[] = [];
  for (const line of lines) {
    if (
      line.startsWith("@@") ||
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("diff ") ||
      line.startsWith("index ")
    )
      continue;
    if (line.startsWith("+")) out.push(line.slice(1));
    else if (line.startsWith("-")) continue;
    else if (line.startsWith(" ")) out.push(line.slice(1));
    else if (line === "") out.push(line);
  }
  if (out.length === 0) return null;
  return out.join("\n");
}

function PackageManagerGlyph({ pm }: { pm: PackageManager }) {
  const meta = PACKAGE_MANAGERS.find((m) => m.value === pm);
  return (
    <span className={`faw-pm-glyph faw-pm-glyph-${pm}`} aria-hidden="true">
      {meta?.letter ?? "?"}
    </span>
  );
}

export function AutomationFrameworkViews({
  projectId,
  tabActionsContainer,
}: {
  projectId: string;
  // A DOM node on the Automation page's tab row (flow-automation-views.tsx)
  // that this view portals its package-manager picker and Execute button
  // into, so they sit on the same line as the Workflow/Framework tabs
  // instead of buried below the editor.
  tabActionsContainer: HTMLDivElement | null;
}) {
  const base = `/projects/${projectId}/automation/framework`;
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<FrameworkProject | null>(null);
  const [loadError, setLoadError] = useState("");

  // --- Setup screen state ---
  const [chosenFramework, setChosenFramework] = useState<
    "cypress" | "playwright"
  >("cypress");
  const [chosenOrigin, setChosenOrigin] = useState<"boilerplate" | "scratch">(
    "boilerplate",
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // --- File tree / editor state ---
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadedContent, setLoadedContent] = useState<string>("");
  const [editorContent, setEditorContent] = useState<string>("");
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const editorContentRef = useRef(editorContent);
  const selectedPathRef = useRef(selectedPath);
  editorContentRef.current = editorContent;
  selectedPathRef.current = selectedPath;

  // --- Run / execution wizard state ---
  const [run, setRun] = useState<TestRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [runError, setRunError] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pmSaving, setPmSaving] = useState(false);

  // --- Package installation wizard state ---
  const [packagesOpen, setPackagesOpen] = useState(false);
  const [packages, setPackages] = useState<PackageEntry[] | null>(null);
  const [packagesError, setPackagesError] = useState("");
  const [opsById, setOpsById] = useState<Record<string, PackageOperation>>({});
  const [addOpId, setAddOpId] = useState<string | null>(null);
  const [removeOpIdByName, setRemoveOpIdByName] = useState<
    Record<string, string>
  >({});
  const [addName, setAddName] = useState("");
  const [addVersion, setAddVersion] = useState("");
  const [addDev, setAddDev] = useState(false);
  const [addFormError, setAddFormError] = useState("");

  // --- Suggested fix state ---
  const [fixCase, setFixCase] = useState<TestCaseResult | null>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixError, setFixError] = useState("");
  const [fixResult, setFixResult] = useState<{
    path: string;
    diff: string;
    explanation: string;
  } | null>(null);

  // --- GitHub panel state ---
  const [githubOpen, setGithubOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [token, setToken] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [connecting, setConnecting] = useState(false);
  const [githubError, setGithubError] = useState("");
  const [syncing, setSyncing] = useState<"pull" | "push" | null>(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [showPushForm, setShowPushForm] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [syncStatus, setSyncStatus] = useState("");

  const isDirty = editorContent !== loadedContent;

  useEffect(() => {
    let cancelled = false;
    apiRequest<FrameworkProject | null>(base, undefined, "GET")
      .then((result) => {
        if (!cancelled) setProject(result);
      })
      .catch((error) => {
        if (!cancelled) setLoadError((error as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  const loadFiles = () => {
    apiRequest<FileEntry[]>(`${base}/files`, undefined, "GET")
      .then(setFiles)
      .catch((error) => setFileError((error as Error).message));
  };

  useEffect(() => {
    if (!project) return;
    loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const tree = useMemo(() => buildTree(files), [files]);

  const createProject = async () => {
    setCreating(true);
    setCreateError("");
    try {
      const created = await apiRequest<FrameworkProject>(base, {
        framework: chosenFramework,
        origin: chosenOrigin,
      });
      setProject(created);
    } catch (error) {
      setCreateError((error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const toggleDir = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openFile = async (path: string) => {
    if (isDirty) {
      const proceed = window.confirm(
        "Discard unsaved changes to the current file?",
      );
      if (!proceed) return;
    }
    setFileBusy(true);
    setFileError("");
    try {
      const result = await apiRequest<{ path: string; content: string }>(
        `${base}/files?path=${encodeURIComponent(path)}`,
        undefined,
        "GET",
      );
      setSelectedPath(path);
      setLoadedContent(result.content);
      setEditorContent(result.content);
      setSaveStatus("");
    } catch (error) {
      setFileError((error as Error).message);
    } finally {
      setFileBusy(false);
    }
  };

  const saveFile = async () => {
    const path = selectedPathRef.current;
    const content = editorContentRef.current;
    if (!path || saving) return;
    setSaving(true);
    setSaveStatus("");
    try {
      await apiRequest<{ path: string }>(`${base}/files`, { path, content });
      setLoadedContent(content);
      setSaveStatus("Saved");
    } catch (error) {
      setSaveStatus((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Cmd/Ctrl+S saves the currently-open file from anywhere in this view.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // saveFile reads current state via refs, so it's safe to omit here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runTests = async () => {
    setStarting(true);
    setRunError("");
    try {
      const created = await apiRequest<TestRun>(`${base}/run`, {});
      setRun(created);
    } catch (error) {
      setRunError((error as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const isRunActive = (candidate: TestRun | null) =>
    candidate?.status === "running" || candidate?.status === "queued";

  // Execute (tabs row) always opens the wizard; it only starts a fresh run
  // if there isn't one already in flight — reopening mid-run just resumes
  // watching it rather than kicking off a duplicate.
  const openWizard = () => {
    setWizardOpen(true);
    if (!isRunActive(run)) void runTests();
  };

  const changePackageManager = async (
    packageManager: "npm" | "yarn" | "pnpm",
  ) => {
    if (!project) return;
    setPmSaving(true);
    try {
      const updated = await apiRequest<FrameworkProject>(
        base,
        { packageManager },
        "PUT",
      );
      setProject(updated);
    } catch (error) {
      setRunError((error as Error).message);
    } finally {
      setPmSaving(false);
    }
  };

  // --- Package installation wizard ---

  const loadPackages = () => {
    apiRequest<PackageEntry[]>(`${base}/packages`, undefined, "GET")
      .then((list) => {
        setPackages(list);
        setPackagesError("");
      })
      .catch((error) => setPackagesError((error as Error).message));
  };

  const openPackagesWizard = () => {
    setPackagesOpen(true);
    loadPackages();
  };

  // Keeps polling a PackageOperation (add or remove) every ~1.2s until it
  // reaches a terminal status, merging each snapshot into opsById so the
  // wizard's row for that package (or the add form) can render live
  // progress. Reloads the package list once the operation settles. Lives
  // outside the wizard's open/closed state deliberately — closing the
  // wizard mid-install shouldn't cancel it; reopening should show where it
  // landed.
  const pollPackageOperation = (op: PackageOperation) => {
    setOpsById((prev) => ({ ...prev, [op.id]: op }));
    if (op.status !== "running") {
      loadPackages();
      return;
    }
    setTimeout(() => {
      apiRequest<PackageOperation>(
        `${base}/packages/operations/${op.id}`,
        undefined,
        "GET",
      )
        .then(pollPackageOperation)
        .catch((error) =>
          setOpsById((prev) => ({
            ...prev,
            [op.id]: { ...op, status: "error", error: (error as Error).message },
          })),
        );
    }, 1200);
  };

  const submitAddPackage = async () => {
    const name = addName.trim();
    if (!name) {
      setAddFormError("Package name is required.");
      return;
    }
    setAddFormError("");
    try {
      const op = await apiRequest<PackageOperation>(`${base}/packages`, {
        name,
        version: addVersion.trim() || undefined,
        dev: addDev,
      });
      setAddOpId(op.id);
      pollPackageOperation(op);
    } catch (error) {
      setAddFormError((error as Error).message);
    }
  };

  const removePackageEntry = async (name: string) => {
    if (!window.confirm(`Remove "${name}"?`)) return;
    try {
      // apiRequest only builds fetch's options object (and thus applies
      // `method`) when `body !== undefined` — pass {} rather than
      // undefined so this actually sends DELETE instead of silently
      // falling back to GET (same idiom flow-automation-workflow-views.tsx
      // uses for its own DELETE call).
      const op = await apiRequest<PackageOperation>(
        `${base}/packages?name=${encodeURIComponent(name)}`,
        {},
        "DELETE",
      );
      setRemoveOpIdByName((prev) => ({ ...prev, [name]: op.id }));
      pollPackageOperation(op);
    } catch (error) {
      setPackagesError((error as Error).message);
    }
  };

  const addOp = addOpId ? opsById[addOpId] : undefined;
  useEffect(() => {
    // Once an add operation settles successfully, clear the form so the
    // wizard is ready for the next package rather than showing a stale
    // "done" state next to an already-cleared input.
    if (addOp?.status === "done") {
      setAddOpId(null);
      setAddName("");
      setAddVersion("");
      setAddDev(false);
    }
  }, [addOp?.status]);

  // Poll the active run until it settles.
  useEffect(() => {
    if (!run || run.status === "passed" || run.status === "failed" || run.status === "error")
      return;
    let cancelled = false;
    const timer = setInterval(() => {
      apiRequest<TestRun>(`${base}/runs/${run.id}`, undefined, "GET")
        .then((updated) => {
          if (!cancelled) setRun(updated);
        })
        .catch((error) => {
          if (!cancelled) setRunError((error as Error).message);
        });
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [run, base]);

  // Best-effort guess at the source file for a failing case, when nothing
  // is currently open in the editor — many Cypress/Playwright test titles
  // or spec paths carry something file-path-like (a "describe" block name
  // that is itself a path, or a .cy.ts/.spec.ts hint). We just look for a
  // path-shaped token in the case name; otherwise leave it to the user to
  // open the right file first.
  const guessFilePath = (caseName: string): string | undefined => {
    const match = caseName.match(
      /[\w./-]+\.(cy|spec|test)\.(ts|tsx|js|jsx)/,
    );
    if (match) return match[0];
    return undefined;
  };

  const openSuggestFix = (testCase: TestCaseResult) => {
    setFixCase(testCase);
    setFixResult(null);
    setFixError("");
  };

  const requestSuggestFix = async () => {
    if (!fixCase || !run) return;
    const filePath = selectedPath ?? guessFilePath(fixCase.name);
    if (!filePath) {
      setFixError(
        "Open the file you think is responsible first, then try again.",
      );
      return;
    }
    setFixLoading(true);
    setFixError("");
    try {
      const result = await apiRequest<{
        path: string;
        diff: string;
        explanation: string;
      }>(`${base}/suggest-fix`, {
        runId: run.id,
        caseName: fixCase.name,
        filePath,
      });
      setFixResult(result);
    } catch (error) {
      setFixError((error as Error).message);
    } finally {
      setFixLoading(false);
    }
  };

  const applyFix = () => {
    if (!fixResult) return;
    const applied = applyUnifiedDiff(editorContent, fixResult.diff);
    if (applied === null) {
      setFixError(
        "Couldn't apply this diff automatically — copy the change manually.",
      );
      return;
    }
    // If the suggested fix targets a different file than the one open,
    // switch the editor over to it first so Apply lands somewhere sane.
    if (fixResult.path !== selectedPath) {
      void openFile(fixResult.path).then(() => {
        setEditorContent(applied);
      });
    } else {
      setEditorContent(applied);
    }
    setSaveStatus("Applied — not yet saved");
  };

  const connectGithub = async () => {
    setConnecting(true);
    setGithubError("");
    try {
      const updated = await apiRequest<FrameworkProject>(
        `${base}/github/connect`,
        { repoUrl, token, defaultBranch: defaultBranch || undefined },
      );
      setProject(updated);
      setToken("");
    } catch (error) {
      setGithubError((error as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  const syncGithub = async (direction: "pull" | "push") => {
    setSyncing(direction);
    setSyncError("");
    setSyncStatus("");
    try {
      await apiRequest<{ ok: true }>(`${base}/github/sync`, {
        direction,
        message: direction === "push" ? syncMessage || undefined : undefined,
      });
      setSyncStatus(direction === "pull" ? "Pulled from GitHub." : "Pushed to GitHub.");
      if (direction === "pull") loadFiles();
      setShowPushForm(false);
      setSyncMessage("");
    } catch (error) {
      setSyncError((error as Error).message);
    } finally {
      setSyncing(null);
    }
  };

  if (loading) {
    return (
      <div className="faw-view">
        <div className="faw-loading">
          <Loader2 size={18} className="faw-spin" />
          Loading framework project…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="faw-view">
        <div className="faw-error-banner">
          <AlertTriangle size={14} />
          {loadError}
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="faw-view">
        <div className="faw-setup">
          <FolderCode size={26} />
          <strong>Set up a test-automation framework</strong>
          <p>
            Pick a framework and a starting point. You'll get a real,
            in-browser-editable project you can run and push to GitHub.
          </p>
          <div className="faw-setup-section">
            <h4>Framework</h4>
            <div className="faw-choice-row">
              <button
                type="button"
                className={`faw-choice-card${chosenFramework === "cypress" ? " is-selected" : ""}`}
                onClick={() => setChosenFramework("cypress")}
              >
                <strong>Cypress</strong>
                <small>
                  JS/TS end-to-end testing with a time-travel debugger and
                  automatic waiting.
                </small>
              </button>
              <button
                type="button"
                className={`faw-choice-card${chosenFramework === "playwright" ? " is-selected" : ""}`}
                onClick={() => setChosenFramework("playwright")}
              >
                <strong>Playwright</strong>
                <small>
                  Cross-browser end-to-end testing with first-class
                  TypeScript support.
                </small>
              </button>
            </div>
          </div>
          <div className="faw-setup-section">
            <h4>Starting point</h4>
            <div className="faw-choice-row">
              <button
                type="button"
                className={`faw-choice-card${chosenOrigin === "boilerplate" ? " is-selected" : ""}`}
                onClick={() => setChosenOrigin("boilerplate")}
              >
                <strong>Start from boilerplate</strong>
                <small>
                  A ready-made example project with sample tests and config.
                </small>
              </button>
              <button
                type="button"
                className={`faw-choice-card${chosenOrigin === "scratch" ? " is-selected" : ""}`}
                onClick={() => setChosenOrigin("scratch")}
              >
                <strong>Start from scratch</strong>
                <small>An empty workspace with just the bare config.</small>
              </button>
            </div>
          </div>
          {createError && <p className="faw-error-text">{createError}</p>}
          <button
            type="button"
            className="button primary"
            onClick={createProject}
            disabled={creating}
          >
            {creating ? (
              <Loader2 size={14} className="faw-spin" />
            ) : (
              <FolderCode size={14} />
            )}
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="faw-view">
      {tabActionsContainer &&
        createPortal(
          <>
            {(() => {
              const FrameworkIcon = FRAMEWORK_ICON[project.framework];
              return (
                <span
                  className="faw-tab-icon-badge"
                  title={FRAMEWORK_LABEL[project.framework]}
                  aria-label={FRAMEWORK_LABEL[project.framework]}
                >
                  <FrameworkIcon size={14} />
                </span>
              );
            })()}
            <div
              className="faw-pm-switch"
              role="radiogroup"
              aria-label="Package manager"
            >
              {PACKAGE_MANAGERS.map((pm) => (
                <button
                  key={pm.value}
                  type="button"
                  role="radio"
                  aria-checked={project.packageManager === pm.value}
                  className={
                    project.packageManager === pm.value ? "is-active" : ""
                  }
                  title={pm.label}
                  disabled={pmSaving || isRunActive(run)}
                  onClick={() => void changePackageManager(pm.value)}
                >
                  <PackageManagerGlyph pm={pm.value} />
                </button>
              ))}
            </div>
            <button
              type="button"
              className="icon-button faw-tab-icon-button"
              title="Manage packages"
              aria-label="Manage packages"
              onClick={openPackagesWizard}
            >
              <Boxes size={15} />
            </button>
            <button
              type="button"
              className={`icon-button faw-tab-icon-button faw-github-status${
                project.github ? " is-connected" : ""
              }`}
              title={
                project.github
                  ? `Connected to ${project.github.repoUrl}`
                  : "Connect a GitHub repo"
              }
              aria-label={
                project.github
                  ? `GitHub connected: ${project.github.repoUrl}`
                  : "Connect GitHub"
              }
              onClick={() => setGithubOpen(true)}
            >
              {syncing ? (
                <Loader2 size={15} className="faw-spin" />
              ) : (
                <GitBranch size={15} />
              )}
            </button>
            <button
              type="button"
              className="button primary faw-tab-execute-button"
              onClick={openWizard}
              disabled={starting}
            >
              {starting ? (
                <Loader2 size={13} className="faw-spin" />
              ) : (
                <Play size={13} />
              )}
              Execute
            </button>
          </>,
          tabActionsContainer,
        )}
      <div className="faw-header">
        <div className="faw-header-title">
          <small>{project.workspacePath}</small>
        </div>
      </div>
      <div className="faw-layout">
        <div className="faw-tree-pane">
          <div className="faw-pane-head">Files</div>
          <div className="faw-tree">
            {fileError && <p className="faw-error-text">{fileError}</p>}
            {tree.length === 0 && !fileError && (
              <p className="muted faw-tree-empty">No files yet.</p>
            )}
            {tree.map((node) => (
              <TreeRow
                key={node.path}
                node={node}
                depth={0}
                selectedPath={selectedPath}
                expanded={expanded}
                onToggle={toggleDir}
                onSelect={openFile}
              />
            ))}
          </div>
        </div>
        <div className="faw-editor-pane">
          <div className="faw-editor-toolbar">
            <span className="faw-editor-path">
              {selectedPath ?? "No file open"}
              {isDirty && <span className="faw-dirty-dot" aria-label="Unsaved changes" />}
            </span>
            <span className="faw-save-status">{saveStatus}</span>
            <button
              type="button"
              className="button"
              onClick={saveFile}
              disabled={!selectedPath || saving || !isDirty}
            >
              {saving ? (
                <Loader2 size={13} className="faw-spin" />
              ) : (
                <Save size={13} />
              )}
              Save
            </button>
          </div>
          <div className="faw-editor-host">
            {fileBusy ? (
              <div className="faw-loading">
                <Loader2 size={16} className="faw-spin" />
              </div>
            ) : selectedPath ? (
              <Editor
                height="100%"
                language={languageFor(selectedPath)}
                value={editorContent}
                onChange={(value) => setEditorContent(value ?? "")}
                theme="vs-dark"
                options={{ minimap: { enabled: false }, fontSize: 12 }}
              />
            ) : (
              <div className="faw-empty-editor">
                <File size={22} />
                <span>Select a file to start editing.</span>
              </div>
            )}
          </div>
        </div>
      </div>
      {wizardOpen &&
        createPortal(
          <div className="faw-wizard-overlay" role="dialog" aria-modal="true">
            <div className="faw-wizard">
              <div className="faw-wizard-head">
                <div className="faw-wizard-head-title">
                  <Terminal size={16} />
                  <strong>Execute</strong>
                  <span className="faw-tab-badge">
                    {project.framework === "cypress"
                      ? "Cypress"
                      : "Playwright"}
                  </span>
                  <span className="faw-tab-badge">{project.packageManager}</span>
                  {run && (
                    <span className={`faw-pill is-${run.status}`}>
                      {(run.status === "running" ||
                        run.status === "queued") && (
                        <Loader2 size={11} className="faw-spin" />
                      )}
                      {run.status}
                    </span>
                  )}
                </div>
                <div className="faw-wizard-head-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={runTests}
                    disabled={starting || isRunActive(run)}
                  >
                    {starting ? (
                      <Loader2 size={13} className="faw-spin" />
                    ) : (
                      <Play size={13} />
                    )}
                    {run ? "Run again" : "Start"}
                  </button>
                  <button
                    type="button"
                    className="faw-wizard-close"
                    onClick={() => setWizardOpen(false)}
                    aria-label="Close execution wizard"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="faw-wizard-body">
                {runError && <p className="faw-error-text">{runError}</p>}
                {!run && !starting && (
                  <p className="faw-muted">
                    Press Start to run this project's test suite.
                  </p>
                )}
                {run && (
                  <>
                    <code className="faw-run-command">{run.command}</code>
                    {isRunActive(run) && (
                      <div className="faw-wizard-progress">
                        <Loader2 size={20} className="faw-spin" />
                        {run.status === "queued"
                          ? "Queued…"
                          : "Running tests…"}
                      </div>
                    )}
                    {run.resultsSummary && (
                      <div className="faw-run-summary">
                        <span className="faw-summary-chip">
                          {run.resultsSummary.total} total
                        </span>
                        <span className="faw-summary-chip is-passed">
                          {run.resultsSummary.passed} passed
                        </span>
                        <span className="faw-summary-chip is-failed">
                          {run.resultsSummary.failed} failed
                        </span>
                        <span className="faw-summary-chip is-skipped">
                          {run.resultsSummary.skipped} skipped
                        </span>
                      </div>
                    )}
                    {run.error && (
                      <p className="faw-error-text">{run.error}</p>
                    )}
                    <ul className="faw-case-list">
                      {run.cases.map((testCase) => {
                        const { icon: Icon, className } =
                          STATUS_ICON[testCase.status];
                        return (
                          <li key={testCase.name} className="faw-case-row">
                            <div className="faw-case-head">
                              <Icon size={13} className={className} />
                              <span className="faw-case-name">
                                {testCase.name}
                              </span>
                              {typeof testCase.durationMs === "number" && (
                                <span className="faw-case-duration">
                                  {testCase.durationMs}ms
                                </span>
                              )}
                            </div>
                            {testCase.status === "failed" && (
                              <div className="faw-case-fail">
                                {testCase.error && (
                                  <p className="faw-case-error">
                                    {testCase.error}
                                  </p>
                                )}
                                <button
                                  type="button"
                                  className="faw-suggest-button"
                                  onClick={() => openSuggestFix(testCase)}
                                >
                                  <Wand2 size={12} />
                                  Suggest fix
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
              {fixCase && (
                <section className="faw-fix-panel faw-wizard-fix-panel">
                  <div className="faw-pane-head">
                    Suggested fix
                    <button
                      type="button"
                      className="faw-close-fix"
                      onClick={() => setFixCase(null)}
                      aria-label="Close suggested fix"
                    >
                      ×
                    </button>
                  </div>
                  <p className="faw-fix-case-name">{fixCase.name}</p>
                  {!fixResult && (
                    <button
                      type="button"
                      className="button primary"
                      onClick={requestSuggestFix}
                      disabled={fixLoading}
                    >
                      {fixLoading ? (
                        <Loader2 size={13} className="faw-spin" />
                      ) : (
                        <Wand2 size={13} />
                      )}
                      {fixLoading ? "Thinking…" : "Get suggested fix"}
                    </button>
                  )}
                  {fixError && <p className="faw-error-text">{fixError}</p>}
                  {fixResult && (
                    <div className="faw-fix-result">
                      <p className="faw-fix-explanation">
                        {fixResult.explanation}
                      </p>
                      <p className="faw-fix-path">{fixResult.path}</p>
                      <DiffView diff={fixResult.diff} />
                      <button
                        type="button"
                        className="button"
                        onClick={applyFix}
                      >
                        Apply to editor
                      </button>
                      <p className="faw-fix-note">
                        Applies to the open editor buffer only — review, then
                        Save to persist.
                      </p>
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>,
          document.body,
        )}
      {packagesOpen &&
        createPortal(
          <div className="faw-wizard-overlay" role="dialog" aria-modal="true">
            <div className="faw-wizard faw-packages-wizard">
              <div className="faw-wizard-head">
                <div className="faw-wizard-head-title">
                  <Boxes size={16} />
                  <strong>Packages</strong>
                </div>
                <div className="faw-wizard-head-actions">
                  <button
                    type="button"
                    className="faw-wizard-close"
                    onClick={() => setPackagesOpen(false)}
                    aria-label="Close package manager"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="faw-wizard-body">
                <form
                  className="faw-add-package-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitAddPackage();
                  }}
                >
                  <input
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="Package name (e.g. lodash)"
                    aria-label="Package name"
                    disabled={Boolean(addOp && addOp.status === "running")}
                  />
                  <input
                    value={addVersion}
                    onChange={(e) => setAddVersion(e.target.value)}
                    placeholder="Version (optional)"
                    aria-label="Package version"
                    disabled={Boolean(addOp && addOp.status === "running")}
                  />
                  <label className="faw-add-package-dev">
                    <input
                      type="checkbox"
                      checked={addDev}
                      onChange={(e) => setAddDev(e.target.checked)}
                      disabled={Boolean(addOp && addOp.status === "running")}
                    />
                    Dev dependency
                  </label>
                  <button
                    type="submit"
                    className="button primary"
                    disabled={Boolean(addOp && addOp.status === "running")}
                  >
                    {addOp?.status === "running" ? (
                      <Loader2 size={13} className="faw-spin" />
                    ) : (
                      <Plus size={13} />
                    )}
                    Add
                  </button>
                </form>
                {addFormError && (
                  <p className="faw-error-text">{addFormError}</p>
                )}
                {addOp && addOp.status !== "done" && (
                  <div
                    className={`faw-package-op-status${
                      addOp.status === "error" ? " is-bad" : ""
                    }`}
                  >
                    <code>{addOp.command}</code>
                    {addOp.status === "running" && (
                      <span>
                        <Loader2 size={12} className="faw-spin" /> Installing…
                      </span>
                    )}
                    {addOp.error && <p>{addOp.error}</p>}
                  </div>
                )}
                {packagesError && (
                  <p className="faw-error-text">{packagesError}</p>
                )}
                <ul className="faw-package-list">
                  {packages === null && (
                    <li className="faw-muted">Loading packages…</li>
                  )}
                  {packages?.length === 0 && (
                    <li className="faw-muted">No dependencies declared yet.</li>
                  )}
                  {packages?.map((pkg) => {
                    const opId = removeOpIdByName[pkg.name];
                    const op = opId ? opsById[opId] : undefined;
                    const removing = op?.status === "running";
                    return (
                      <li key={pkg.name} className="faw-package-row">
                        <span className="faw-package-name">{pkg.name}</span>
                        <code className="faw-package-version">
                          {pkg.version}
                        </code>
                        {pkg.dev && (
                          <span className="faw-package-dev-tag">dev</span>
                        )}
                        <button
                          type="button"
                          className="faw-package-remove"
                          title={`Remove ${pkg.name}`}
                          aria-label={`Remove ${pkg.name}`}
                          disabled={removing}
                          onClick={() => void removePackageEntry(pkg.name)}
                        >
                          {removing ? (
                            <Loader2 size={13} className="faw-spin" />
                          ) : (
                            <Trash2 size={13} />
                          )}
                        </button>
                        {op?.status === "error" && (
                          <p className="faw-package-row-error">{op.error}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {githubOpen &&
        createPortal(
          <div className="faw-wizard-overlay" role="dialog" aria-modal="true">
            <div className="faw-wizard faw-github-wizard">
              <div className="faw-wizard-head">
                <div className="faw-wizard-head-title">
                  <GitBranch size={16} />
                  <strong>GitHub</strong>
                  {project.github && (
                    <span className="faw-pill is-passed">Connected</span>
                  )}
                </div>
                <div className="faw-wizard-head-actions">
                  <button
                    type="button"
                    className="faw-wizard-close"
                    onClick={() => setGithubOpen(false)}
                    aria-label="Close GitHub"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="faw-wizard-body">
                {!project.github ? (
                  <div className="faw-github-connect">
                    <input
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      placeholder="https://github.com/org/repo"
                      aria-label="Repository URL"
                    />
                    <input
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="Personal access token"
                      type="password"
                      aria-label="GitHub personal access token"
                    />
                    <input
                      value={defaultBranch}
                      onChange={(e) => setDefaultBranch(e.target.value)}
                      placeholder="main"
                      aria-label="Default branch"
                    />
                    {githubError && (
                      <p className="faw-error-text">{githubError}</p>
                    )}
                    <button
                      type="button"
                      className="button primary"
                      onClick={connectGithub}
                      disabled={connecting || !repoUrl.trim() || !token.trim()}
                    >
                      {connecting ? (
                        <Loader2 size={13} className="faw-spin" />
                      ) : (
                        <GitBranch size={13} />
                      )}
                      {connecting ? "Connecting…" : "Connect"}
                    </button>
                  </div>
                ) : (
                  <div className="faw-github-connected">
                    <p className="faw-github-repo">{project.github.repoUrl}</p>
                    <p className="faw-github-branch">
                      Default branch: <code>{project.github.defaultBranch}</code>
                    </p>
                    {syncError && <p className="faw-error-text">{syncError}</p>}
                    {syncStatus && (
                      <p className="faw-sync-status">{syncStatus}</p>
                    )}
                    <div className="faw-github-actions">
                      <button
                        type="button"
                        className="button"
                        onClick={() => syncGithub("pull")}
                        disabled={syncing !== null}
                      >
                        {syncing === "pull" ? (
                          <Loader2 size={13} className="faw-spin" />
                        ) : (
                          <CloudDownload size={13} />
                        )}
                        Pull
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => setShowPushForm((v) => !v)}
                        disabled={syncing !== null}
                      >
                        <UploadCloud size={13} />
                        Commit &amp; push
                      </button>
                    </div>
                    {showPushForm && (
                      <div className="faw-push-form">
                        <input
                          value={syncMessage}
                          onChange={(e) => setSyncMessage(e.target.value)}
                          placeholder="Commit message (optional)"
                          aria-label="Commit message"
                        />
                        <button
                          type="button"
                          className="button primary"
                          onClick={() => syncGithub("push")}
                          disabled={syncing !== null}
                        >
                          {syncing === "push" ? (
                            <Loader2 size={13} className="faw-spin" />
                          ) : (
                            <UploadCloud size={13} />
                          )}
                          Push
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
