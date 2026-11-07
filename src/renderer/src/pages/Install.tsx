import type { DiscordInstall, ToolInfo, ToolName } from "@shared/types";
import {
    AlertTriangle,
    Check,
    Download,
    ExternalLink,
    FolderOpen,
    FolderSearch,
    Hammer,
    Package,
    RefreshCw,
    Rocket,
    Syringe,
    Unplug,
    Wrench
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { TaskPanel } from "../components/TaskView";
import { Badge, Button, Checkbox, confirmDialog, PatchBadge, Spinner, Switch } from "../components/ui";
import { act, useBusy, useStore } from "../store";

const toolLabels: Record<ToolName, { name: string; url: string; desc: string }> = {
    git: { name: "Git", url: "https://git-scm.com/downloads", desc: "Downloads the source code and keeps it up to date" },
    node: { name: "Node.js", url: "https://nodejs.org/en/download", desc: "Runs the Vencord build" },
    pnpm: { name: "pnpm", url: "https://pnpm.io/installation", desc: "Installs Vencord's dependencies" }
};

function Step({
    n,
    title,
    desc,
    state,
    children,
    right
}: {
    n: number;
    title: ReactNode;
    desc?: ReactNode;
    state: "done" | "active" | "warn" | "todo";
    children?: ReactNode;
    right?: ReactNode;
}) {
    return (
        <div className={`step ${state === "todo" ? "" : state}`}>
            <div className="step-num">{state === "done" ? <Check size={14} strokeWidth={2.5} /> : n}</div>
            <div className="step-body">
                <div className="row" style={{ alignItems: "flex-start" }}>
                    <div className="grow">
                        <div className="step-title">{title}</div>
                        {desc && <p className="step-desc">{desc}</p>}
                    </div>
                    {right && (
                        <div className="row" style={{ gap: 6, flex: "none" }}>
                            {right}
                        </div>
                    )}
                </div>
                {children && <div className="step-content">{children}</div>}
            </div>
        </div>
    );
}

function ToolRow({ tool }: { tool: ToolInfo }) {
    const env = useStore(s => s.env);
    const busy = useBusy();
    const label = toolLabels[tool.name];
    const canAuto = tool.name === "pnpm" ? !!env?.tools.node.found : !!env?.installer;
    const via = tool.name === "pnpm" ? "" : env?.installer === "winget" ? " (winget)" : env?.installer === "brew" ? " (Homebrew)" : "";

    return (
        <div className="list-item" style={{ padding: "12px 0" }}>
            <div className={`card-icon ${tool.ok ? "green" : tool.found ? "yellow" : "red"}`} style={{ width: 30, height: 30, borderRadius: 7 }}>
                {tool.ok ? <Check size={14} strokeWidth={2.5} /> : <AlertTriangle size={14} />}
            </div>
            <div className="grow">
                <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>{label.name}</span>
                    {tool.version && <span className="faint small mono">{tool.version}</span>}
                    {!tool.ok && <Badge color={tool.found ? "yellow" : "red"}>{tool.problem}</Badge>}
                </div>
                <div className="small faint">{label.desc}</div>
            </div>
            {!tool.ok && (
                <div className="row" style={{ gap: 6 }}>
                    <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => window.vu.openExternal(label.url)}>
                        Download
                    </Button>
                    {canAuto && (
                        <Button
                            size="sm"
                            variant="primary"
                            icon={Download}
                            disabled={busy}
                            onClick={() => act(window.vu.env.install(tool.name), `${label.name} was installed`)}
                        >
                            {tool.found ? "Repair" : "Install"}
                            {via}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}

function TargetPicker({ installs, selected, onChange }: { installs: DiscordInstall[]; selected: string[]; onChange(ids: string[]): void }) {
    if (!installs.length) {
        return (
            <div className="callout yellow">
                <AlertTriangle size={15} />
                <div>No Discord installation found. Install Discord, then click “Re-check”.</div>
            </div>
        );
    }
    return (
        <div className="stack" style={{ gap: 8 }}>
            {installs.map(inst => {
                const on = selected.includes(inst.id);
                return (
                    <div
                        key={inst.id}
                        className={`select-item${on ? " on" : ""}`}
                        style={{ marginBottom: 0, alignItems: "center" }}
                        onClick={() => onChange(on ? selected.filter(i => i !== inst.id) : [...selected, inst.id])}
                    >
                        <Checkbox on={on} />
                        <div className="grow">
                            <div className="row" style={{ gap: 8 }}>
                                <span style={{ fontWeight: 500 }}>{inst.name}</span>
                                {inst.version && <span className="faint small">v{inst.version}</span>}
                            </div>
                            <div className="small faint mono ellipsis">{inst.path}</div>
                        </div>
                        <PatchBadge kind={inst.patch.kind} sourceDir={inst.patch.sourceDir} />
                        {inst.running && <Badge color="accent">Running</Badge>}
                    </div>
                );
            })}
        </div>
    );
}

export function InstallPage() {
    const env = useStore(s => s.env);
    const vencord = useStore(s => s.vencord);
    const config = useStore(s => s.config);
    const discord = useStore(s => s.discord);
    const task = useStore(s => s.task);
    const refresh = useStore(s => s.refresh);
    const setPage = useStore(s => s.setPage);
    const busy = useBusy();
    const [checking, setChecking] = useState(false);
    const [removeOfficial, setRemoveOfficial] = useState(true);
    const [targets, setTargets] = useState<string[] | null>(null);

    useEffect(() => {
        refresh("env", "discord", "vencord");
    }, [refresh]);

    const effectiveTargets = useMemo(() => {
        if (targets) return targets;
        const saved = (config?.targets ?? []).filter(t => discord.some(d => d.id === t));
        if (saved.length) return saved;
        const stable = discord.find(d => d.branch === "stable") ?? discord[0];
        return stable ? [stable.id] : [];
    }, [targets, config?.targets, discord]);

    const tools = env ? Object.values(env.tools) : [];
    const toolsOk = !!env && tools.every(t => t.ok);
    const foreign = discord.filter(d => d.patch.kind === "official" || d.patch.kind === "other" || d.patch.kind === "broken");
    const cloned = !!vencord?.isVencord;
    const built = cloned && !!vencord?.built;
    const injected = discord.some(d => d.patch.kind === "source");
    const done = built && injected;
    const showTask = task && (task.status === "running" || Date.now() - (task.endedAt ?? 0) < 5 * 60_000);

    const recheck = async () => {
        setChecking(true);
        await refresh("env", "discord", "vencord");
        setChecking(false);
    };

    const runAll = async () => {
        const running = discord.filter(d => effectiveTargets.includes(d.id) && d.running);
        if (running.length) {
            const ok = await confirmDialog({
                title: "Discord will restart",
                text: `${running.map(r => r.name).join(", ")} will be closed briefly during setup and restarted automatically.`,
                confirm: "Got it"
            });
            if (!ok) return;
        }
        const res = await act(
            window.vu.vencord.install({ removeOfficial, inject: effectiveTargets.length > 0, targets: effectiveTargets }),
            "Vencord was installed from source 🎉"
        );
        if (res.ok) setPage("dashboard");
    };

    const uninstallForeign = async () => {
        const ok = await confirmDialog({
            title: "Uninstall official Vencord?",
            text: (
                <>
                    The Vencord patch is removed from {foreign.map(f => f.name).join(", ")} and Discord is restored to its original state. A running Discord is
                    closed briefly. Your Vencord settings, themes and QuickCSS are kept and will be reused by the source build.
                </>
            ),
            confirm: "Uninstall",
            danger: true
        });
        if (ok) act(window.vu.discord.uninject(foreign.map(f => f.id)), "Official Vencord was removed");
    };

    return (
        <>
            <div className="page-header">
                <div>
                    <h1 className="page-title">Install</h1>
                    <p className="page-sub">Set up Vencord from source – step by step or fully automatic.</p>
                </div>
                <Button variant="ghost" icon={RefreshCw} loading={checking} onClick={recheck}>
                    Re-check
                </Button>
            </div>

            <div className="card hero" style={{ marginBottom: 12 }}>
                <div className="row" style={{ gap: 16, alignItems: "center" }}>
                    <div className="card-icon accent" style={{ width: 40, height: 40, borderRadius: 10 }}>
                        <Rocket size={18} />
                    </div>
                    <div className="grow">
                        <h2 className="hero-title" style={{ fontSize: 17 }}>
                            {done ? "All set" : "Set everything up automatically"}
                        </h2>
                        <div className="muted small" style={{ marginTop: 2 }}>
                            {done
                                ? "Vencord is running from source. You can run the setup again at any time to repair it."
                                : "Removes the official Vencord, downloads the source code, builds it and injects it into the selected Discord installations."}
                        </div>
                        {!toolsOk && env && (
                            <div className="small" style={{ marginTop: 6, color: "var(--yellow)" }}>
                                Install the missing requirements first (step 1).
                            </div>
                        )}
                    </div>
                    <Button variant="primary" icon={done ? Wrench : Rocket} disabled={busy || !toolsOk} onClick={runAll}>
                        {done ? "Run again" : "Set up now"}
                    </Button>
                </div>
            </div>

            {showTask && (
                <div style={{ marginBottom: 12 }}>
                    <TaskPanel task={task} />
                </div>
            )}

            <div className="steps" style={{ marginTop: 28 }}>
                <Step
                    n={1}
                    title="Requirements"
                    desc="Vencord needs Git, Node.js and pnpm. You can install missing tools right here."
                    state={!env ? "todo" : toolsOk ? "done" : "warn"}
                >
                    {!env ? (
                        <div className="row muted">
                            <Spinner /> Checking installed tools …
                        </div>
                    ) : (
                        <div className="list">
                            {tools.map(t => (
                                <ToolRow key={t.name} tool={t} />
                            ))}
                        </div>
                    )}
                    {env && !toolsOk && env.platform === "win32" && (
                        <div className="small faint" style={{ marginTop: 8 }}>
                            After installing Git or Node.js, click “Re-check” if needed.
                        </div>
                    )}
                </Step>

                <Step
                    n={2}
                    title="Remove official Vencord"
                    desc="An existing Vencord install (from the official installer) is replaced by the source build."
                    state={foreign.length ? "warn" : "done"}
                    right={
                        foreign.length > 0 && (
                            <Button size="sm" variant="danger" icon={Unplug} disabled={busy} onClick={uninstallForeign}>
                                Uninstall now
                            </Button>
                        )
                    }
                >
                    {foreign.length === 0 ? (
                        <div className="row small muted">
                            <Check size={14} style={{ color: "var(--green)" }} /> No other Vencord installation found.
                        </div>
                    ) : (
                        <div className="stack">
                            {foreign.map(f => (
                                <div key={f.id} className="row small">
                                    <PatchBadge kind={f.patch.kind} sourceDir={f.patch.sourceDir} />
                                    <span style={{ fontWeight: 500 }}>{f.name}</span>
                                    <span className="faint mono ellipsis grow" title={f.patch.patcherPath}>
                                        {f.patch.patcherPath ?? ""}
                                    </span>
                                </div>
                            ))}
                            <div className="row" style={{ marginTop: 6 }}>
                                <Switch on={removeOfficial} onChange={setRemoveOfficial} />
                                <span className="small">Remove during automatic setup</span>
                            </div>
                        </div>
                    )}
                </Step>

                <Step
                    n={3}
                    title="Location"
                    desc="The Vencord source code is stored here. Custom plugins go into src/userplugins."
                    state={cloned ? "done" : "active"}
                    right={
                        <>
                            {vencord?.exists && (
                                <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => window.vu.openPath(vencord.dir)}>
                                    Open
                                </Button>
                            )}
                            <Button size="sm" icon={FolderSearch} disabled={busy} onClick={() => window.vu.vencord.chooseDir()}>
                                Change
                            </Button>
                        </>
                    }
                >
                    <div className="path">{config?.vencordDir}</div>
                    <div className="row small faint" style={{ marginTop: 10 }}>
                        Source: <span className="mono">{config?.repoUrl}</span>
                        {config?.repoBranch && <span className="mono">({config.repoBranch})</span>}
                        {cloned && <Badge color="green">Downloaded</Badge>}
                        {vencord?.exists && !cloned && <Badge color="yellow">Folder exists but is not a Vencord repo</Badge>}
                    </div>
                </Step>

                <Step
                    n={4}
                    title="Download & build"
                    desc={
                        <>
                            Runs <code>git clone</code>, <code>pnpm install --frozen-lockfile</code> and <code>pnpm build</code>.
                        </>
                    }
                    state={built ? "done" : cloned ? "active" : "todo"}
                    right={
                        cloned && (
                            <>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    icon={Package}
                                    disabled={busy || !toolsOk}
                                    onClick={() => act(window.vu.vencord.deps(), "Dependencies installed")}
                                >
                                    Install dependencies
                                </Button>
                                <Button
                                    size="sm"
                                    icon={Hammer}
                                    disabled={busy || !toolsOk}
                                    onClick={() => act(window.vu.vencord.build(false), "Vencord was built")}
                                >
                                    Build
                                </Button>
                            </>
                        )
                    }
                >
                    <div className="row wrap">
                        <Badge color={cloned ? "green" : undefined}>Source code</Badge>
                        <Badge color={vencord?.depsInstalled ? "green" : undefined}>Dependencies</Badge>
                        <Badge color={built ? "green" : undefined}>Build</Badge>
                    </div>
                </Step>

                <Step
                    n={5}
                    title="Inject into Discord"
                    desc="Choose which Discord installations should load your source build."
                    state={injected ? "done" : built ? "active" : "todo"}
                    right={
                        built && (
                            <Button
                                size="sm"
                                variant="primary"
                                icon={Syringe}
                                disabled={busy || !effectiveTargets.length}
                                onClick={() => act(window.vu.discord.inject(effectiveTargets), "Vencord was injected")}
                            >
                                Inject
                            </Button>
                        )
                    }
                >
                    <TargetPicker
                        installs={discord}
                        selected={effectiveTargets}
                        onChange={ids => {
                            setTargets(ids);
                            window.vu.setConfig({ targets: ids });
                        }}
                    />
                </Step>
            </div>
        </>
    );
}
