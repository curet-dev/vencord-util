import type { LogLine, StepStatus, TaskState } from "@shared/types";
import { AlertTriangle, Ban, CheckCircle2, ChevronDown, Circle, CircleDot, Copy, Loader2, Puzzle, Square, Terminal, Trash2, XCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildAndRestart } from "../actions";
import { useBusy, useStore } from "../store";
import { Button, fmtTime } from "./ui";

export function StepIcon({ status }: { status: StepStatus }) {
    switch (status) {
        case "running":
            return <Loader2 size={14} className="spin" style={{ color: "var(--accent)" }} />;
        case "done":
            return <CheckCircle2 size={14} style={{ color: "var(--green)" }} />;
        case "error":
            return <XCircle size={14} style={{ color: "var(--red)" }} />;
        case "skipped":
            return <CircleDot size={14} style={{ color: "var(--text-3)" }} />;
        default:
            return <Circle size={14} style={{ color: "var(--text-3)" }} />;
    }
}

function progressOf(task: TaskState) {
    const total = task.steps.length || 1;
    const done = task.steps.filter(s => s.status === "done" || s.status === "skipped").length;
    const running = task.steps.some(s => s.status === "running") ? 0.5 : 0;
    return Math.min(100, ((done + running) / total) * 100);
}

function statusText(task: TaskState) {
    const current = task.steps.find(s => s.status === "running");
    if (task.status === "running") return current?.detail ?? current?.label ?? "Running …";
    if (task.status === "success") return "Done";
    if (task.status === "cancelled") return "Cancelled";
    return "Failed";
}

function TaskIcon({ task, size = 16 }: { task: TaskState; size?: number }) {
    if (task.status === "running") return <Loader2 size={size} className="spin" style={{ color: "var(--accent)", flex: "none" }} />;
    if (task.status === "success") return <CheckCircle2 size={size} style={{ color: "var(--green)", flex: "none" }} />;
    if (task.status === "cancelled") return <Ban size={size} style={{ color: "var(--yellow)", flex: "none" }} />;
    return <XCircle size={size} style={{ color: "var(--red)", flex: "none" }} />;
}

function BrokenPluginActions({ ids }: { ids: string[] }) {
    const plugins = useStore(s => s.plugins);
    const setPage = useStore(s => s.setPage);
    const toast = useStore(s => s.toast);
    const busy = useBusy();
    const enabled = ids.filter(id => plugins.some(plugin => plugin.id === id && plugin.enabled));
    if (!enabled.length) return null;
    const names = enabled.map(id => plugins.find(plugin => plugin.id === id)?.name ?? id);

    const disableAndRebuild = async () => {
        for (const id of enabled) {
            const result = await window.vu.plugins.setEnabled(id, false);
            if (!result.ok) {
                toast({ kind: "error", title: result.error ?? `Could not disable ${id}`, text: result.hint });
                return;
            }
        }
        await buildAndRestart();
    };

    return (
        <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
            <Button size="sm" variant="danger" icon={Ban} disabled={busy} onClick={disableAndRebuild}>
                Disable {names.length === 1 ? `“${names[0]}”` : `${names.length} plugins`} &amp; rebuild
            </Button>
            <Button size="sm" variant="ghost" icon={Puzzle} onClick={() => setPage("plugins")}>
                Open plugins
            </Button>
        </div>
    );
}

export function TaskPanel({ task, compact }: { task: TaskState; compact?: boolean }) {
    const setLogOpen = useStore(s => s.setLogOpen);
    const running = task.status === "running";
    const showSteps = !compact && task.steps.length > 1;

    return (
        <div className="card task-panel fade-in">
            <div className="row">
                <TaskIcon task={task} />
                <div className="grow ellipsis" style={{ fontWeight: 500 }}>
                    {task.title}
                    {!showSteps && <span className="faint"> · {statusText(task)}</span>}
                </div>
                <Button size="sm" variant="ghost" icon={Terminal} onClick={() => setLogOpen(true)}>
                    Output
                </Button>
                {running && (
                    <Button size="sm" variant="danger" icon={Square} onClick={() => window.vu.cancelTask()}>
                        Cancel
                    </Button>
                )}
            </div>
            {running && (
                <div className="progress">
                    <div style={{ width: `${progressOf(task)}%` }} />
                </div>
            )}
            {showSteps && (
                <div className="task-steps">
                    {task.steps.map(s => (
                        <div key={s.id} className={`task-step ${s.status}`}>
                            <span className="ico">
                                <StepIcon status={s.status} />
                            </span>
                            <span>{s.label}</span>
                            {s.detail && <span className="faint small">· {s.detail}</span>}
                        </div>
                    ))}
                </div>
            )}
            {task.status === "error" && (
                <div className="callout red">
                    <AlertTriangle size={15} />
                    <div className="grow">
                        <div style={{ fontWeight: 500 }} className="selectable">
                            {task.error}
                        </div>
                        {task.hint && (
                            <div className="selectable" style={{ marginTop: 4, opacity: 0.85, whiteSpace: "pre-line" }}>
                                {task.hint}
                            </div>
                        )}
                        {task.brokenPlugins?.length ? <BrokenPluginActions ids={task.brokenPlugins} /> : null}
                    </div>
                </div>
            )}
        </div>
    );
}

export function TaskPill() {
    const task = useStore(s => s.task);
    const setLogOpen = useStore(s => s.setLogOpen);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!task) return;
        setVisible(true);
        if (task.status !== "running") {
            const t = setTimeout(() => setVisible(false), 8000);
            return () => clearTimeout(t);
        }
    }, [task]);

    if (!task || !visible) return null;
    const status = statusText(task);
    return (
        <button type="button" className="task-pill fade-in" onClick={() => setLogOpen(true)} title={`${task.title} – ${status}`}>
            <TaskIcon task={task} size={14} />
            <span className="ellipsis">{task.title}</span>
            <span className="s ellipsis">· {status}</span>
        </button>
    );
}

export function LogView({ lines, style, showTime = true }: { lines: LogLine[]; style?: React.CSSProperties; showTime?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const stick = useRef(true);
    const visible = useMemo(() => lines.slice(-1500), [lines]);

    useLayoutEffect(() => {
        const el = ref.current;
        if (el && stick.current && visible.length) el.scrollTop = el.scrollHeight;
    }, [visible]);

    return (
        <div
            className="log"
            ref={ref}
            style={style}
            onScroll={e => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
        >
            {visible.length === 0 && <div className="log-line faint">No output yet.</div>}
            {visible.map(l => (
                <div key={l.id} className={`log-line ${l.level}`}>
                    {showTime && <span className="ts">{fmtTime(l.ts)}</span>}
                    {l.text}
                </div>
            ))}
        </div>
    );
}

export function copyLogs(lines: LogLine[]) {
    const text = lines.map(l => `[${fmtTime(l.ts)}] ${l.text}`).join("\n");
    navigator.clipboard.writeText(text);
    useStore.getState().toast({ kind: "info", title: "Output copied to clipboard" });
}

export function LogDrawer() {
    const open = useStore(s => s.logOpen);
    const setOpen = useStore(s => s.setLogOpen);
    const logs = useStore(s => s.logs);
    const task = useStore(s => s.task);
    if (!open) return null;
    return (
        <div className="drawer">
            <div className="drawer-head">
                <Terminal size={14} className="muted" />
                <span>Output</span>
                {task?.status === "running" && <span className="faint small">· {task.title}</span>}
                <div className="grow" />
                <Button size="sm" variant="ghost" icon={Copy} iconOnly title="Copy" onClick={() => copyLogs(logs)} />
                <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    iconOnly
                    title="Clear"
                    onClick={async () => {
                        await window.vu.clearLogs();
                        useStore.setState({ logs: [] });
                    }}
                />
                <Button size="sm" variant="ghost" icon={ChevronDown} iconOnly title="Close" onClick={() => setOpen(false)} />
            </div>
            <LogView lines={logs} />
        </div>
    );
}
