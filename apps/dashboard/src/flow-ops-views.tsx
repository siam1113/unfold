import React, { useMemo } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  Bot,
  CheckCircle2,
  Clock3,
  Layers3,
  ListOrdered,
  MousePointer2,
  PauseCircle,
  PlayCircle,
  Route,
  XCircle,
} from "lucide-react";
import type {
  ActionEdge,
  AppState,
  RunData,
  RunEvent,
  TaskLease,
} from "../../../packages/shared/src/index";
import "./flow-ops-views.css";

export type FlowOpsSelection = { kind: "state" | "action"; id: string };

export interface FlowOpsViewProps {
  data: RunData;
  states: AppState[];
  actions: ActionEdge[];
  onSelect: (selection: FlowOpsSelection) => void;
}

type TimelineRecord = {
  key: string;
  kind: "state" | "action" | "event";
  worker: number | null;
  time: string;
  timestamp: number;
  title: string;
  detail: string;
  level?: RunEvent["level"];
  selection?: FlowOpsSelection;
};

const shortTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
};

const safeTimestamp = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
};

const stateTitle = (state: AppState) =>
  state.title?.trim() ||
  state.routeKey ||
  new URL(state.url).pathname ||
  "Screen";

const taskDescription = (task: TaskLease) => {
  if (task.kind === "route") return `Open route · ${task.url}`;
  return `${task.action} · ${task.url}`;
};

const statusIcon = (status: TaskLease["status"]) => {
  if (status === "done") return <CheckCircle2 size={13} aria-hidden="true" />;
  if (status === "failed") return <XCircle size={13} aria-hidden="true" />;
  if (status === "leased") return <PlayCircle size={13} aria-hidden="true" />;
  return <PauseCircle size={13} aria-hidden="true" />;
};

/** Timestamped worker activity. Time order is descriptive only, not causal. */
export function WorkerSwimlanes({
  data,
  states,
  actions,
  onSelect,
}: FlowOpsViewProps) {
  const records = useMemo<TimelineRecord[]>(() => {
    const stateById = new Map(states.map((state) => [state.id, state]));
    const timeline: TimelineRecord[] = [
      ...states.map((state) => ({
        key: `state:${state.id}`,
        kind: "state" as const,
        worker: state.worker,
        time: state.discoveredAt,
        timestamp: safeTimestamp(state.discoveredAt),
        title: stateTitle(state),
        detail: `${state.routeKey} · depth ${state.depth}`,
        selection: { kind: "state" as const, id: state.id },
      })),
      ...actions.map((action) => {
        const target = action.toStateId
          ? stateById.get(action.toStateId)
          : undefined;
        return {
          key: `action:${action.id}`,
          kind: "action" as const,
          worker: action.worker,
          time: action.createdAt,
          timestamp: safeTimestamp(action.createdAt),
          title: `${action.action} ${action.targetName || "control"}`,
          detail: target
            ? `→ ${stateTitle(target)} · ${action.decision}`
            : `${action.decision} · depth ${action.depth}`,
          selection: { kind: "action" as const, id: action.id },
        };
      }),
      ...data.events.map((event) => ({
        key: `event:${event.id}`,
        kind: "event" as const,
        worker: event.worker ?? null,
        time: event.time,
        timestamp: safeTimestamp(event.time),
        title: event.message,
        detail: `${event.level} event`,
        level: event.level,
      })),
    ];
    return timeline.sort(
      (a, b) => a.timestamp - b.timestamp || a.key.localeCompare(b.key),
    );
  }, [actions, data.events, states]);

  const lanes = useMemo(() => {
    const grouped = new Map<number | null, TimelineRecord[]>();
    for (const record of records) {
      const lane = grouped.get(record.worker) || [];
      lane.push(record);
      grouped.set(record.worker, lane);
    }
    return [...grouped.entries()].sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    });
  }, [records]);
  const workerTasks = useMemo(() => {
    const grouped = new Map<number, TaskLease[]>();
    for (const task of data.tasks) {
      if (task.worker === undefined) continue;
      grouped.set(task.worker, [...(grouped.get(task.worker) || []), task]);
    }
    return [...grouped.entries()].sort(([a], [b]) => a - b);
  }, [data.tasks]);
  const branches = useMemo(() => {
    const workerIds = new Set<number>([
      ...states.flatMap((state) =>
        state.worker === null ? [] : [state.worker],
      ),
      ...actions.map((action) => action.worker),
      ...data.tasks.flatMap((task) =>
        task.worker === undefined ? [] : [task.worker],
      ),
      ...data.events.flatMap((event) =>
        event.worker === undefined ? [] : [event.worker],
      ),
    ]);
    return [...workerIds]
      .sort((a, b) => a - b)
      .map((worker) => {
        const workerActions = actions
          .filter((action) => action.worker === worker)
          .sort(
            (a, b) => safeTimestamp(a.createdAt) - safeTimestamp(b.createdAt),
          );
        const tasks = data.tasks.filter((task) => task.worker === worker);
        const workerStates = states.filter((state) => state.worker === worker);
        const events = data.events.filter((event) => event.worker === worker);
        return { worker, workerActions, tasks, workerStates, events };
      });
  }, [actions, data.events, data.tasks, states]);

  return (
    <section className="flow-ops" aria-labelledby="flow-ops-workers-title">
      <header className="flow-ops-heading">
        <div>
          <h2 id="flow-ops-workers-title">Worker swimlanes</h2>
          <p>Compare recorded activity across workers.</p>
        </div>
        <div className="flow-ops-counts" aria-label="Timeline totals">
          <span>
            <b>{states.length}</b> screens
          </span>
          <span>
            <b>{actions.length}</b> actions
          </span>
          <span>
            <b>{data.events.length}</b> events
          </span>
        </div>
      </header>

      <p className="flow-ops-note">
        <Clock3 size={14} aria-hidden="true" />
        Events are ordered by recorded timestamps. Parallel work can overlap, so
        this view does not show causal order.
      </p>

      {lanes.length === 0 ? (
        <div className="flow-ops-empty">
          <Bot size={20} aria-hidden="true" />
          <strong>No timestamped worker activity</strong>
          <span>
            Recorded screens, actions, and worker events will appear here.
          </span>
        </div>
      ) : (
        <div
          className="flow-ops-lanes"
          role="list"
          aria-label="Worker activity lanes"
        >
          {lanes.map(([worker, lane]) => (
            <div
              className="flow-ops-lane"
              role="listitem"
              key={worker ?? "unassigned"}
            >
              <div className="flow-ops-lane-label">
                <span className="flow-ops-worker-mark">
                  <Bot size={15} aria-hidden="true" />
                </span>
                <strong>
                  {worker === null ? "Unassigned" : `Worker ${worker}`}
                </strong>
                <small>{lane.length} records</small>
              </div>
              <div className="flow-ops-lane-track">
                {lane.map((record) => {
                  const content = (
                    <>
                      <span
                        className={`flow-ops-record-icon ${record.kind} ${record.level || ""}`}
                      >
                        {record.kind === "state" ? (
                          <Layers3 size={13} />
                        ) : record.kind === "action" ? (
                          <MousePointer2 size={13} />
                        ) : (
                          <AlertTriangle size={13} />
                        )}
                      </span>
                      <time dateTime={record.time} title={record.time}>
                        {shortTime(record.time)}
                      </time>
                      <strong>{record.title}</strong>
                      <span>{record.detail}</span>
                    </>
                  );
                  return record.selection ? (
                    <button
                      className={`flow-ops-record ${record.kind}`}
                      key={record.key}
                      type="button"
                      onClick={() => onSelect(record.selection!)}
                      title={`${record.title} · ${record.time}`}
                    >
                      {content}
                    </button>
                  ) : (
                    <article
                      className={`flow-ops-record ${record.kind} ${record.level || ""}`}
                      key={record.key}
                      title={`${record.title} · ${record.time}`}
                    >
                      {content}
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {workerTasks.length > 0 && (
        <div className="flow-ops-assignments">
          <div className="flow-ops-subheading">
            <h3>Task assignments</h3>
            <span>Current task records by assigned worker</span>
          </div>
          <div className="flow-ops-assignment-grid">
            {workerTasks.map(([worker, tasks]) => (
              <div className="flow-ops-assignment" key={worker}>
                <strong>Worker {worker}</strong>
                <span>
                  {tasks.length} task{tasks.length === 1 ? "" : "s"}
                </span>
                <div>
                  {tasks.map((task) => (
                    <span
                      className={`flow-ops-status ${task.status}`}
                      key={task.id}
                    >
                      {statusIcon(task.status)}
                      {task.status}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {branches.length > 0 && (
        <div className="flow-ops-branches">
          <div className="flow-ops-subheading">
            <h3>Worker branch evidence</h3>
            <span>
              Timestamp order is descriptive; arrows show each recorded action
              link, and task assignments are a run snapshot.
            </span>
          </div>
          <div className="flow-ops-branch-grid">
            {branches.map(
              ({ worker, workerActions, tasks, workerStates, events }) => {
                const statuses = [
                  "done",
                  "failed",
                  "leased",
                  "pending",
                ] as const;
                const latestAction = workerActions[workerActions.length - 1];
                const latestTarget = latestAction?.toStateId
                  ? states.find((state) => state.id === latestAction.toStateId)
                  : undefined;
                return (
                  <article className="flow-ops-branch" key={worker}>
                    <header>
                      <strong>
                        <Bot size={14} aria-hidden="true" /> Worker {worker}
                      </strong>
                      <span>
                        {workerStates.length} states · {workerActions.length}{" "}
                        actions · {events.length} events
                      </span>
                    </header>
                    <div className="flow-ops-branch-end">
                      <span>Latest recorded action outcome</span>
                      <b>
                        {latestAction
                          ? latestTarget
                            ? `Reached ${stateTitle(latestTarget)}`
                            : latestAction.decision === "failed"
                              ? "Failed; destination not recorded"
                              : latestAction.decision === "skipped_policy"
                                ? "Skipped by policy"
                                : "No destination state recorded"
                          : "No action edge recorded"}
                      </b>
                    </div>
                    {workerActions.length > 0 ? (
                      <ol className="flow-ops-branch-path">
                        {workerActions.map((action) => (
                          <li key={action.id}>
                            <button
                              type="button"
                              onClick={() =>
                                onSelect({ kind: "action", id: action.id })
                              }
                            >
                              <span>
                                Depth {action.depth} · {action.action}{" "}
                                {action.targetName || "control"}
                              </span>
                              <b>
                                {(() => {
                                  const source = states.find(
                                    (state) => state.id === action.fromStateId,
                                  );
                                  return source
                                    ? stateTitle(source)
                                    : "Source state not recorded";
                                })()}
                              </b>
                              <small>
                                →{" "}
                                {action.toStateId
                                  ? (() => {
                                      const target = states.find(
                                        (state) =>
                                          state.id === action.toStateId,
                                      );
                                      return target
                                        ? stateTitle(target)
                                        : "Destination state missing";
                                    })()
                                  : action.decision === "failed"
                                    ? "failed; no destination"
                                    : action.decision === "skipped_policy"
                                      ? "skipped by policy"
                                      : "destination not recorded"}
                              </small>
                            </button>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="flow-ops-branch-missing">
                        No action links recorded for this worker.
                      </p>
                    )}
                    <div
                      className="flow-ops-branch-task-status"
                      aria-label={`Worker ${worker} task statuses`}
                    >
                      {tasks.length ? (
                        statuses.map((status) => {
                          const count = tasks.filter(
                            (task) => task.status === status,
                          ).length;
                          return count ? (
                            <span
                              className={`flow-ops-status ${status}`}
                              key={status}
                            >
                              {count} {status}
                            </span>
                          ) : null;
                        })
                      ) : (
                        <span className="flow-ops-branch-missing">
                          No linked task assignment
                        </span>
                      )}
                    </div>
                  </article>
                );
              },
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Queue snapshot arranged by depth and scheduler priority. */
export function FrontierQueueMap({
  data,
  states,
  actions: _actions,
  onSelect,
}: FlowOpsViewProps) {
  const stateById = useMemo(
    () => new Map(states.map((state) => [state.id, state])),
    [states],
  );
  const depths = useMemo(() => {
    const groups = new Map<number, TaskLease[]>();
    for (const task of data.tasks)
      groups.set(task.depth, [...(groups.get(task.depth) || []), task]);
    return [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([depth, tasks]) => ({
        depth,
        tasks: tasks
          .map((task, index) => ({ task, index }))
          .sort(
            (a, b) => b.task.priority - a.task.priority || a.index - b.index,
          )
          .map(({ task }) => task),
      }));
  }, [data.tasks]);
  const counts = useMemo(
    () => ({
      pending: data.tasks.filter((task) => task.status === "pending").length,
      leased: data.tasks.filter((task) => task.status === "leased").length,
      done: data.tasks.filter((task) => task.status === "done").length,
      failed: data.tasks.filter((task) => task.status === "failed").length,
    }),
    [data.tasks],
  );
  const activeWorkers = new Set(
    data.tasks
      .filter((task) => task.status === "leased" && task.worker !== undefined)
      .map((task) => task.worker),
  ).size;
  const depthHealth = useMemo(() => {
    const depthSet = new Set<number>([
      ...data.tasks.map((task) => task.depth),
      ...states.map((state) => state.depth),
      ..._actions.map((action) => action.depth),
    ]);
    return [...depthSet]
      .sort((a, b) => a - b)
      .map((depth) => {
        const tasks = data.tasks.filter((task) => task.depth === depth);
        const depthStates = states.filter((state) => state.depth === depth);
        const depthActions = _actions.filter(
          (action) => action.depth === depth,
        );
        const workers = new Set<number>([
          ...tasks.flatMap((task) =>
            task.worker === undefined ? [] : [task.worker],
          ),
          ...depthActions.map((action) => action.worker),
          ...depthStates.flatMap((state) =>
            state.worker === null ? [] : [state.worker],
          ),
        ]);
        return {
          depth,
          tasks,
          stateCount: depthStates.length,
          actionCount: depthActions.length,
          workerCount: workers.size,
          statuses: {
            done: tasks.filter((task) => task.status === "done").length,
            failed: tasks.filter((task) => task.status === "failed").length,
            leased: tasks.filter((task) => task.status === "leased").length,
            pending: tasks.filter((task) => task.status === "pending").length,
          },
        };
      });
  }, [data.tasks, states, _actions]);
  const maxDepthTasks = Math.max(
    1,
    ...depthHealth.map((group) => group.tasks.length),
  );

  return (
    <section className="flow-ops" aria-labelledby="flow-ops-frontier-title">
      <header className="flow-ops-heading">
        <div>
          <h2 id="flow-ops-frontier-title">Frontier and queue</h2>
          <p>See what remains to explore, grouped by route depth.</p>
        </div>
        <div className="flow-ops-counts" aria-label="Queue totals">
          <span>
            <b>{counts.pending}</b> pending
          </span>
          <span>
            <b>{counts.leased}</b> leased
          </span>
          <span>
            <b>{activeWorkers}</b> workers assigned
          </span>
        </div>
      </header>

      <div className="flow-ops-queue-note">
        <ListOrdered size={14} aria-hidden="true" />
        Pending tasks follow depth ascending, then priority descending. Ties are
        shown in the order provided by this run snapshot; no task timestamp is
        recorded.
      </div>

      {depthHealth.length > 0 && (
        <div
          className="flow-ops-funnel"
          aria-label="Observed crawl depth funnel"
        >
          {depthHealth.map((group) => (
            <article className="flow-ops-funnel-depth" key={group.depth}>
              <header>
                <strong>Depth {group.depth}</strong>
                <span>{group.tasks.length} recorded tasks</span>
              </header>
              <div className="flow-ops-funnel-bar" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.max(5, (group.tasks.length / maxDepthTasks) * 100)}%`,
                  }}
                />
              </div>
              <div className="flow-ops-funnel-counts">
                <span>
                  <b>{group.statuses.done}</b> done
                </span>
                <span>
                  <b>{group.statuses.failed}</b> failed
                </span>
                <span>
                  <b>{group.statuses.leased}</b> leased
                </span>
                <span>
                  <b>{group.statuses.pending}</b> pending
                </span>
              </div>
              <footer>
                {group.stateCount} observed states · {group.actionCount}{" "}
                observed actions · {group.workerCount} workers
              </footer>
              {group.tasks.length === 0 && (
                <small className="flow-ops-funnel-unknown">
                  No task records at this observed depth; task outcome coverage
                  is unknown.
                </small>
              )}
            </article>
          ))}
        </div>
      )}

      {depths.length === 0 ? (
        <div className="flow-ops-empty">
          <Route size={20} aria-hidden="true" />
          <strong>The frontier is empty</strong>
          <span>No task records are available for this discovery run.</span>
        </div>
      ) : (
        <div className="flow-ops-depths" aria-label="Task queue by depth">
          {depths.map(({ depth, tasks }) => (
            <section
              className="flow-ops-depth-column"
              key={depth}
              aria-labelledby={`flow-ops-depth-${depth}`}
            >
              <header>
                <span className="flow-ops-depth-icon">
                  <ArrowDownRight size={14} aria-hidden="true" />
                </span>
                <div>
                  <h3 id={`flow-ops-depth-${depth}`}>Depth {depth}</h3>
                  <small>
                    {tasks.length} task{tasks.length === 1 ? "" : "s"}
                  </small>
                </div>
              </header>
              <div className="flow-ops-task-stack">
                {tasks.map((task, index) => {
                  const source = task.stateId
                    ? stateById.get(task.stateId)
                    : undefined;
                  const taskContent = (
                    <>
                      <div className="flow-ops-task-topline">
                        <span className={`flow-ops-status ${task.status}`}>
                          {statusIcon(task.status)}
                          {task.status}
                        </span>
                        <span className="flow-ops-priority">
                          Priority {task.priority}
                        </span>
                      </div>
                      <strong>
                        {task.kind === "route"
                          ? "Route visit"
                          : `${task.action} control`}
                      </strong>
                      <span className="flow-ops-task-url" title={task.url}>
                        {task.url}
                      </span>
                      <span className="flow-ops-task-meta">
                        {source
                          ? `From ${stateTitle(source)}`
                          : task.kind === "route"
                            ? "Seed or route task"
                            : "Source screen not recorded"}
                        {task.worker !== undefined &&
                          ` · Worker ${task.worker}`}
                      </span>
                      <span className="flow-ops-task-meta">
                        {task.attempts} attempt{task.attempts === 1 ? "" : "s"}
                        {task.elementId ? ` · element ${task.elementId}` : ""}
                        {task.valueKey ? ` · value ${task.valueKey}` : ""}
                      </span>
                      {task.leaseUntil !== undefined &&
                        task.status === "leased" && (
                          <span className="flow-ops-task-meta">
                            Lease expires{" "}
                            {new Date(task.leaseUntil).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </span>
                        )}
                    </>
                  );
                  return source ? (
                    <button
                      className={`flow-ops-task ${task.status}`}
                      type="button"
                      key={task.id}
                      onClick={() => onSelect({ kind: "state", id: source.id })}
                      aria-label={`Select source screen for ${taskDescription(task)}`}
                    >
                      <span className="flow-ops-queue-position">
                        {index + 1}
                      </span>
                      {taskContent}
                    </button>
                  ) : (
                    <article
                      className={`flow-ops-task ${task.status}`}
                      key={task.id}
                    >
                      <span className="flow-ops-queue-position">
                        {index + 1}
                      </span>
                      {taskContent}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
