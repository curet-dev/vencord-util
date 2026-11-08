import type { PluginCompat, UserPlugin } from "@shared/types";
import {
    AlertTriangle,
    ArrowDownToLine,
    Ban,
    Cpu,
    FileCode2,
    FolderOpen,
    FolderPlus,
    GitBranch,
    HardDrive,
    Link2,
    Plus,
    Puzzle,
    RefreshCw,
    Search,
    Trash2,
    UploadCloud,
    Users
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { checkPluginUpdates, installPluginPaths, installPluginUrl } from "../actions";
import { LinkSourceModal } from "../components/LinkSourceModal";
import { BuildIssueList, CompatIssueList } from "../components/PluginIssues";
import { RebuildBanner } from "../components/RebuildBanner";
import { Badge, Button, confirmDialog, GithubIcon, Switch, timeAgo } from "../components/ui";
import { act, useBusy, useStore } from "../store";

const AUTO_CHECK_INTERVAL_MS = 30 * 60 * 1000;

const AVATARS = [
    { background: "linear-gradient(135deg, #4c2365, #7f5d99)", color: "#c4a4da" },
    { background: "linear-gradient(135deg, #7f5d99, #9e7eb5)", color: "#ffffff" },
    { background: "linear-gradient(135deg, #9e7eb5, #c4a4da)", color: "#14081d" },
    { background: "#4c2365", color: "#c4a4da" },
    { background: "#111111", color: "#c4a4da", boxShadow: "inset 0 0 0 1px #333" }
];

function avatarFor(name: string) {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return AVATARS[hash % AVATARS.length];
}

const displayName = (plugin: UserPlugin) => plugin.name ?? plugin.id.replace(/\.(tsx?|jsx?)$/, "");
const sourceLink = (plugin: UserPlugin) => (plugin.source?.type === "local" ? undefined : plugin.source?.url?.replace(/\.git$/, ""));

function PluginWarnings({ plugin, current, upcoming }: { plugin: UserPlugin; current?: PluginCompat; upcoming?: PluginCompat }) {
    if (!plugin.enabled) return null;
    if (plugin.buildIssues?.length) {
        return (
            <div className="callout red" style={{ marginTop: 10 }}>
                <Ban size={14} />
                <div className="grow">
                    <div style={{ fontWeight: 500 }}>This plugin broke the last build. Update it or disable it.</div>
                    <BuildIssueList issues={plugin.buildIssues} />
                </div>
            </div>
        );
    }
    return (
        <>
            {current && (
                <div className="callout red" style={{ marginTop: 10 }}>
                    <Ban size={14} />
                    <div className="grow">
                        <div style={{ fontWeight: 500 }}>Not compatible with your Vencord version – the build will fail.</div>
                        <CompatIssueList issues={current.issues} />
                    </div>
                </div>
            )}
            {upcoming && (
                <div className="callout yellow" style={{ marginTop: 10 }}>
                    <AlertTriangle size={14} />
                    <div className="grow">
                        <div style={{ fontWeight: 500 }}>The pending Vencord update removes functions this plugin needs.</div>
                        <CompatIssueList issues={upcoming.issues} />
                    </div>
                </div>
            )}
        </>
    );
}

function PluginItem({ plugin, onLink }: { plugin: UserPlugin; onLink(): void }) {
    const current = useStore(s => s.compat?.current.find(entry => entry.id === plugin.id));
    const upcoming = useStore(s => s.compat?.update?.plugins.find(entry => entry.id === plugin.id));
    const broken = plugin.enabled && (Boolean(plugin.buildIssues?.length) || Boolean(current));
    const busy = useBusy();
    const toast = useStore(s => s.toast);
    const name = displayName(plugin);
    const link = sourceLink(plugin);
    const { source, update } = plugin;

    const runUpdate = () => act(window.vu.plugins.update(plugin.id), changed => (changed ? `“${name}” was updated` : `“${name}” is up to date`));

    const remove = async () => {
        const confirmed = await confirmDialog({
            title: `Delete “${name}”?`,
            text: (
                <>
                    <code>src/userplugins/{plugin.id}</code> will be deleted permanently. Vencord has to be rebuilt afterwards.
                </>
            ),
            confirm: "Delete",
            danger: true
        });
        if (!confirmed) return;
        const result = await window.vu.plugins.remove(plugin.id);
        if (result.ok) toast({ kind: "success", title: `“${name}” was deleted` });
        else toast({ kind: "error", title: result.error ?? "Delete failed" });
    };

    const toggle = async (enabled: boolean) => {
        const result = await window.vu.plugins.setEnabled(plugin.id, enabled);
        if (!result.ok) toast({ kind: "error", title: result.error ?? "Error", text: result.hint });
    };

    return (
        <div className={`plugin${plugin.enabled ? "" : " disabled"}`}>
            <div className="plugin-icon" style={{ ...avatarFor(name), opacity: plugin.enabled ? 1 : 0.4 }}>
                {name.charAt(0).toUpperCase()}
            </div>
            <div className="grow">
                <div className="row" style={{ gap: 8 }}>
                    <span className="plugin-name">{name}</span>
                    {update?.available && <Badge color="accent">Update available</Badge>}
                    {broken && <Badge color="red">{plugin.buildIssues?.length ? "Breaks the build" : "Incompatible"}</Badge>}
                    {!broken && plugin.enabled && upcoming && <Badge color="yellow">Breaks with update</Badge>}
                    {!plugin.enabled && <Badge noDot>Disabled</Badge>}
                </div>
                {plugin.description && <div className="plugin-desc">{plugin.description}</div>}
                <div className="plugin-meta">
                    <span className="chip mono" title={plugin.path}>
                        {plugin.kind === "folder" ? <FolderOpen size={12} /> : <FileCode2 size={12} />}
                        {plugin.id}
                    </span>
                    {link ? (
                        <span className="chip link" title={link} onClick={() => window.vu.openExternal(link)}>
                            {/github\.com/.test(link) ? <GithubIcon size={12} /> : <Link2 size={12} />}
                            <span className="ellipsis">
                                {link.replace(/^https?:\/\/(www\.)?/, "")}
                                {source?.subdir ? `/${source.subdir}` : ""}
                            </span>
                        </span>
                    ) : (
                        <span className="chip" title="Not linked to a repository – no update checks">
                            <HardDrive size={12} /> Local
                        </span>
                    )}
                    {plugin.isGit && (
                        <span className="chip" title="Git clone – updated via git pull">
                            <GitBranch size={12} /> Git
                        </span>
                    )}
                    {plugin.hasNative && (
                        <span className="chip" title="Contains native code (native.ts)">
                            <Cpu size={12} /> Native
                        </span>
                    )}
                    {plugin.authors.length > 0 && (
                        <span className="chip">
                            <Users size={12} /> {plugin.authors.slice(0, 3).join(", ")}
                            {plugin.authors.length > 3 ? " …" : ""}
                        </span>
                    )}
                    {source?.installedAt && (
                        <span className="faint small">
                            {source.updatedAt ? "updated" : "added"} {timeAgo(source.updatedAt ?? source.installedAt)}
                        </span>
                    )}
                </div>
                {update?.error && (
                    <div className="row small" style={{ gap: 6, marginTop: 8, color: "var(--yellow)" }}>
                        <AlertTriangle size={13} /> {update.error}
                    </div>
                )}
                <PluginWarnings plugin={plugin} current={current} upcoming={upcoming} />
                {update?.untracked && (
                    <div className="small faint" style={{ marginTop: 8 }}>
                        Not tracked yet – update once to enable update checks.
                    </div>
                )}
            </div>
            <div className="plugin-actions">
                {update?.available ? (
                    <Button size="sm" icon={ArrowDownToLine} disabled={busy} onClick={runUpdate}>
                        Update
                    </Button>
                ) : (
                    plugin.updatable && (
                        <Button size="sm" variant="ghost" iconOnly icon={ArrowDownToLine} title="Fetch latest version" disabled={busy} onClick={runUpdate} />
                    )
                )}
                {!plugin.isGit && (
                    <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon={link ? GitBranch : Link2}
                        title={link ? "Change linked repository" : "Link Git repository (enables updates)"}
                        disabled={busy}
                        onClick={onLink}
                    />
                )}
                <Button size="sm" variant="ghost" iconOnly icon={FolderOpen} title="Show in folder" onClick={() => window.vu.showItem(plugin.path)} />
                <Button size="sm" variant="ghost" iconOnly icon={Trash2} title="Delete" disabled={busy} onClick={remove} />
                <div style={{ width: 10 }} />
                <Switch on={plugin.enabled} onChange={toggle} disabled={busy} title={plugin.enabled ? "Disable (excluded from the build)" : "Enable"} />
            </div>
        </div>
    );
}

function AddPlugin() {
    const busy = useBusy();
    const [url, setUrl] = useState("");
    const [dragOver, setDragOver] = useState(false);

    const submit = async () => {
        if (url.trim() && (await installPluginUrl(url.trim()))) setUrl("");
    };

    return (
        <div className="card">
            <div className="card-head">
                <div className="card-icon accent">
                    <Plus size={16} />
                </div>
                <div className="grow">
                    <h3 className="card-title">Add plugin</h3>
                    <div className="small faint">GitHub repository, folder link, single file or ZIP. Repositories with several plugins let you pick.</div>
                </div>
            </div>
            <form
                className="row"
                onSubmit={event => {
                    event.preventDefault();
                    submit();
                }}
            >
                <div className="input-group">
                    <GithubIcon size={15} />
                    <input
                        className="input"
                        placeholder="https://github.com/user/plugin  ·  …/tree/main/pluginFolder  ·  user/repo"
                        value={url}
                        onChange={event => setUrl(event.target.value)}
                        spellCheck={false}
                    />
                </div>
                <Button variant="primary" type="submit" icon={ArrowDownToLine} disabled={busy || !url.trim()}>
                    Install
                </Button>
            </form>

            <div
                className={`dropzone${dragOver ? " over" : ""}`}
                style={{ marginTop: 14 }}
                onDragEnter={() => setDragOver(true)}
                onDragLeave={() => setDragOver(false)}
                onDrop={() => setDragOver(false)}
            >
                <div className="dropzone-icon">
                    <UploadCloud size={18} />
                </div>
                <div style={{ fontWeight: 500 }}>Drop a plugin here</div>
                <div className="muted small" style={{ marginTop: 3 }}>
                    A folder with <code>index.ts(x)</code>, a single <code>.ts/.tsx</code> file, a <code>.zip</code> – or a link from your browser
                </div>
                <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
                    <Button size="sm" icon={FileCode2} disabled={busy} onClick={async () => installPluginPaths(await window.vu.pickPlugin("file"))}>
                        Choose file
                    </Button>
                    <Button size="sm" icon={FolderPlus} disabled={busy} onClick={async () => installPluginPaths(await window.vu.pickPlugin("folder"))}>
                        Choose folder
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function PluginsPage() {
    const plugins = useStore(s => s.plugins);
    const vencord = useStore(s => s.vencord);
    const lastCheck = useStore(s => s.config?.lastPluginCheck);
    const refresh = useStore(s => s.refresh);
    const setPage = useStore(s => s.setPage);
    const busy = useBusy();
    const refreshCompat = useStore(s => s.refreshCompat);
    const [query, setQuery] = useState("");
    const [checking, setChecking] = useState(false);
    const [linking, setLinking] = useState<string | null>(null);
    const linkingPlugin = plugins.find(plugin => plugin.id === linking);

    const installed = Boolean(vencord?.isVencord);
    const hasUpdatable = plugins.some(plugin => plugin.updatable);
    const pending = plugins.filter(plugin => plugin.update?.available || plugin.update?.untracked).length;

    useEffect(() => {
        refresh("plugins", "vencord").then(() => refreshCompat());
    }, [refresh, refreshCompat]);

    useEffect(() => {
        if (installed && Date.now() - (useStore.getState().config?.lastPluginCheck ?? 0) > AUTO_CHECK_INTERVAL_MS) checkPluginUpdates(true);
    }, [installed]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return plugins;
        return plugins.filter(plugin => [plugin.name, plugin.id, plugin.description, ...plugin.authors].some(value => value?.toLowerCase().includes(needle)));
    }, [plugins, query]);

    const runCheck = async () => {
        setChecking(true);
        await checkPluginUpdates();
        setChecking(false);
    };

    const updateAll = () =>
        act(window.vu.plugins.updateAll(), count => (count ? `Updated ${count} ${count === 1 ? "plugin" : "plugins"}` : "All plugins are up to date"));

    return (
        <>
            <div className="page-header">
                <div>
                    <h1 className="page-title">Plugins</h1>
                    <p className="page-sub">Manage custom plugins in src/userplugins.</p>
                </div>
                <div className="row" style={{ gap: 4 }}>
                    {hasUpdatable && (
                        <Button variant="ghost" icon={RefreshCw} loading={checking} disabled={busy} onClick={runCheck}>
                            Check for updates
                        </Button>
                    )}
                    {pending > 0 && (
                        <Button variant="primary" icon={ArrowDownToLine} disabled={busy} onClick={updateAll}>
                            Update {pending}
                        </Button>
                    )}
                    {vencord && (
                        <Button
                            variant="ghost"
                            icon={FolderOpen}
                            onClick={() => window.vu.openPath(vencord.userPluginsDir).then(error => error && window.vu.openPath(vencord.dir))}
                        >
                            Open folder
                        </Button>
                    )}
                </div>
            </div>

            <RebuildBanner />

            {!installed && vencord && (
                <div className="callout yellow" style={{ marginBottom: 20 }}>
                    <Puzzle size={15} />
                    <div className="grow">
                        Custom plugins require Vencord installed from source. <a onClick={() => setPage("install")}>Install now</a>
                    </div>
                </div>
            )}

            {installed && <AddPlugin />}

            <div className="section-title">
                Installed ({plugins.length})
                {lastCheck && hasUpdatable && (
                    <span className="faint small" style={{ fontWeight: 400 }}>
                        · checked {timeAgo(lastCheck)}
                    </span>
                )}
                <span className="spacer" />
                {plugins.length > 5 && (
                    <div className="input-group" style={{ flex: "none", width: 240, fontWeight: 400 }}>
                        <Search size={14} />
                        <input
                            className="input"
                            style={{ height: 32, fontSize: 13 }}
                            placeholder="Search …"
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                        />
                    </div>
                )}
            </div>
            <div className="card flush">
                {filtered.length === 0 ? (
                    <div className="empty">
                        <Puzzle size={24} />
                        <div>{plugins.length ? "No matches." : "No custom plugins installed yet."}</div>
                        {!plugins.length && installed && (
                            <div className="small faint" style={{ marginTop: 4 }}>
                                Paste a GitHub link above or drop a plugin folder onto the window.
                            </div>
                        )}
                    </div>
                ) : (
                    filtered.map(plugin => <PluginItem key={`${plugin.enabled}-${plugin.id}`} plugin={plugin} onLink={() => setLinking(plugin.id)} />)
                )}
            </div>
            <p className="small faint" style={{ marginTop: 12 }}>
                Disabled plugins are moved to <code>src/userplugins/.disabled</code> and excluded from the build. You can also toggle plugins as usual in
                Discord's Vencord settings.
            </p>
            {linkingPlugin && <LinkSourceModal plugin={linkingPlugin} onClose={() => setLinking(null)} />}
        </>
    );
}
