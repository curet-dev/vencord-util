import { AlertTriangle, ArrowDownToLine, CheckCircle2, FolderOpen, Hammer, Puzzle, RefreshCw, Rocket, Syringe, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { buildAndRestart, checkPluginUpdates, checkUpdates } from "../actions";
import { DiscordRow } from "../components/DiscordRow";
import { RebuildBanner } from "../components/RebuildBanner";
import { TaskPanel } from "../components/TaskView";
import { Badge, Button, confirmDialog, formatDate, timeAgo } from "../components/ui";
import { act, useBusy, useStore } from "../store";

const AUTO_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const DISCORD_POLL_MS = 8000;
const RECENT_TASK_MS = 120_000;

function UpdateCard() {
    const update = useStore(s => s.config?.lastUpdate);
    const dirty = useStore(s => s.vencord?.dirty);
    const pluginUpdates = useStore(s => s.plugins.filter(plugin => plugin.update?.available).length);
    const setPage = useStore(s => s.setPage);
    const busy = useBusy();
    const [checking, setChecking] = useState(false);
    const behind = update?.behind ?? 0;

    const runUpdate = async (stash: boolean) => {
        if (stash) {
            const confirmed = await confirmDialog({
                title: "Stash local changes?",
                text: "Your changes to the Vencord source are saved with “git stash” (not deleted). Plugins in src/userplugins are not affected.",
                confirm: "Stash & update"
            });
            if (!confirmed) return;
        }
        act(window.vu.vencord.update({ stash }), "Vencord was updated");
    };

    const runCheck = async () => {
        setChecking(true);
        await Promise.all([checkUpdates(), checkPluginUpdates(true)]);
        setChecking(false);
    };

    return (
        <div className="card">
            <div className="card-head">
                <div className={`card-icon ${behind ? "yellow" : "green"}`}>{behind ? <ArrowDownToLine size={16} /> : <CheckCircle2 size={16} />}</div>
                <div className="grow">
                    <h3 className="card-title">{behind ? `${behind} ${behind === 1 ? "update" : "updates"} available` : "Up to date"}</h3>
                    <div className="small faint">
                        {update?.error ? <span style={{ color: "var(--red)" }}>{update.error}</span> : `Last checked ${timeAgo(update?.checkedAt)}`}
                    </div>
                </div>
                <Button size="sm" variant="ghost" icon={RefreshCw} loading={checking} disabled={busy} onClick={runCheck}>
                    Check
                </Button>
            </div>
            {behind > 0 ? (
                <>
                    <div style={{ maxHeight: 220, overflowY: "auto", marginBottom: 16 }}>
                        {update?.commits.slice(0, 30).map(commit => (
                            <div key={commit.hash} className="commit">
                                <span className="hash">{commit.hash}</span>
                                <span className="grow ellipsis" title={commit.message}>
                                    {commit.message}
                                </span>
                                <span className="faint small" style={{ flex: "none" }}>
                                    {commit.author} · {timeAgo(commit.date)}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="row wrap">
                        <Button variant="primary" icon={ArrowDownToLine} disabled={busy} onClick={() => runUpdate(false)}>
                            Update now
                        </Button>
                        {dirty && (
                            <Button disabled={busy} onClick={() => runUpdate(true)}>
                                Stash local changes &amp; update
                            </Button>
                        )}
                    </div>
                </>
            ) : (
                <div className="muted small">
                    New commits in the Vencord repository show up here. Updating pulls the changes (<code>git pull</code>), installs dependencies and rebuilds
                    Vencord.
                </div>
            )}
            {pluginUpdates > 0 && (
                <div className="callout accent" style={{ marginTop: 16 }}>
                    <Puzzle size={15} />
                    <div className="grow">
                        {pluginUpdates} plugin {pluginUpdates === 1 ? "update is" : "updates are"} available.{" "}
                        <a onClick={() => setPage("plugins")}>Review plugins</a>
                    </div>
                </div>
            )}
        </div>
    );
}

function Welcome() {
    const setPage = useStore(s => s.setPage);
    const discord = useStore(s => s.discord);
    const official = discord.filter(install => install.patch.kind === "official");

    return (
        <div className="card hero fade-in">
            <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
                <div className="card-icon accent" style={{ width: 40, height: 40, borderRadius: 10 }}>
                    <Rocket size={18} />
                </div>
                <div className="grow">
                    <h2 className="hero-title">Install Vencord from source</h2>
                    <p className="muted" style={{ margin: "6px 0 18px", maxWidth: 620 }}>
                        Vencord Util downloads the Vencord source code, builds it locally and injects it into Discord – no command line required. Afterwards you
                        can add custom plugins via GitHub link or drag &amp; drop.
                    </p>
                    {official.length > 0 && (
                        <div className="callout accent" style={{ marginBottom: 18 }}>
                            <AlertTriangle size={15} />
                            <div>
                                The official Vencord installation was found in {official.map(install => install.name).join(", ")}. It will be replaced during
                                setup – your settings are kept.
                            </div>
                        </div>
                    )}
                    <Button variant="primary" icon={Rocket} onClick={() => setPage("install")}>
                        Start setup
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function DashboardPage() {
    const vencord = useStore(s => s.vencord);
    const config = useStore(s => s.config);
    const discord = useStore(s => s.discord);
    const env = useStore(s => s.env);
    const task = useStore(s => s.task);
    const enabledPlugins = useStore(s => s.plugins.filter(plugin => plugin.enabled).length);
    const loaded = useStore(s => s.loaded);
    const refresh = useStore(s => s.refresh);
    const setPage = useStore(s => s.setPage);
    const busy = useBusy();
    const installed = Boolean(vencord?.isVencord);

    useEffect(() => {
        refresh("discord", "vencord");
        const timer = setInterval(() => refresh("discord"), DISCORD_POLL_MS);
        return () => clearInterval(timer);
    }, [refresh]);

    useEffect(() => {
        if (!installed) return;
        const { config: current } = useStore.getState();
        const now = Date.now();
        if (now - (current?.lastUpdate?.checkedAt ?? 0) > AUTO_CHECK_INTERVAL_MS) checkUpdates(true);
        if (now - (current?.lastPluginCheck ?? 0) > AUTO_CHECK_INTERVAL_MS) checkPluginUpdates(true);
    }, [installed]);

    const injected = discord.filter(install => install.patch.kind === "source");
    const missingTools = env ? Object.values(env.tools).filter(tool => !tool.ok) : [];
    const showTask = task && (task.status === "running" || Date.now() - (task.endedAt ?? 0) < RECENT_TASK_MS);

    return (
        <>
            <div className="page-header">
                <div>
                    <h1 className="page-title">Overview</h1>
                    <p className="page-sub">Status of your Vencord source install.</p>
                </div>
                <Button variant="ghost" icon={RefreshCw} onClick={() => refresh()}>
                    Refresh
                </Button>
            </div>

            <RebuildBanner />

            {loaded.vencord && !installed && <Welcome />}

            {installed && vencord && (
                <div className="card hero fade-in">
                    <div className="row" style={{ alignItems: "flex-start" }}>
                        <div className="grow">
                            <div className="row wrap" style={{ gap: 10 }}>
                                <h2 className="hero-title">Vencord {vencord.version && <span className="muted">v{vencord.version}</span>}</h2>
                                {vencord.built ? <Badge color="green">Built</Badge> : <Badge color="yellow">Not built</Badge>}
                                {injected.length > 0 ? (
                                    <Badge color="accent">Active in {injected.map(install => install.name).join(", ")}</Badge>
                                ) : (
                                    <Badge color="yellow">Not injected</Badge>
                                )}
                                {vencord.dirty && <Badge color="yellow">Local changes</Badge>}
                            </div>
                            <div className="small faint mono ellipsis" style={{ marginTop: 6 }} title={vencord.dir}>
                                {vencord.dir}
                            </div>
                        </div>
                        <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => window.vu.openPath(vencord.dir)}>
                            Open folder
                        </Button>
                    </div>
                    <div className="hero-meta">
                        <div className="meta">
                            <span className="meta-label">Commit</span>
                            <span className="meta-value mono">{vencord.commit ?? "–"}</span>
                        </div>
                        <div className="meta">
                            <span className="meta-label">Branch</span>
                            <span className="meta-value">{vencord.branch ?? "–"}</span>
                        </div>
                        <div className="meta">
                            <span className="meta-label">Committed</span>
                            <span className="meta-value">{timeAgo(vencord.commitDate)}</span>
                        </div>
                        <div className="meta">
                            <span className="meta-label">Built</span>
                            <span className="meta-value">{vencord.builtAt ? formatDate(vencord.builtAt) : "–"}</span>
                        </div>
                        <div className="meta">
                            <span className="meta-label">Plugins</span>
                            <span className="meta-value">
                                <a onClick={() => setPage("plugins")}>{enabledPlugins} enabled</a>
                            </span>
                        </div>
                    </div>
                    {vencord.commitMessage && (
                        <div className="small muted ellipsis" style={{ marginTop: 14 }} title={vencord.commitMessage}>
                            Latest commit: {vencord.commitMessage}
                        </div>
                    )}
                    <div className="row wrap" style={{ marginTop: 20 }}>
                        <Button variant="primary" icon={Hammer} disabled={busy} onClick={() => buildAndRestart()}>
                            {config?.restartDiscordAfterBuild ? "Rebuild & restart" : "Rebuild"}
                        </Button>
                        {!injected.length && vencord.built && (
                            <Button icon={Syringe} disabled={busy} onClick={() => setPage("install")}>
                                Inject into Discord
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {showTask && (
                <div style={{ marginTop: 12 }}>
                    <TaskPanel task={task} />
                </div>
            )}

            {installed && (
                <>
                    <div className="section-title">Updates</div>
                    <UpdateCard />
                </>
            )}

            <div className="section-title">Discord installations</div>
            <div className="card flush">
                {discord.length === 0 ? (
                    <div className="empty">
                        <XCircle size={24} />
                        <div>{loaded.discord ? "No Discord installation found." : "Looking for Discord …"}</div>
                        <div className="small faint" style={{ marginTop: 4 }}>
                            Discord Stable, PTB, Canary and Development are supported.
                        </div>
                    </div>
                ) : (
                    <div className="list">
                        {discord.map(install => (
                            <DiscordRow key={install.id} install={install} />
                        ))}
                    </div>
                )}
            </div>

            {missingTools.length > 0 && (
                <>
                    <div className="section-title">Requirements</div>
                    <div className="callout yellow">
                        <AlertTriangle size={15} />
                        <div className="grow">
                            Missing tools: {missingTools.map(tool => tool.name).join(", ")}. <a onClick={() => setPage("install")}>Set up now</a>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}
