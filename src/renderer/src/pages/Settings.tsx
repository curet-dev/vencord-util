import type { EditableConfig } from "@shared/types";
import { ExternalLink, FolderOpen, FolderSearch, RefreshCw } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button, Switch, timeAgo } from "../components/ui";
import { useBusy, useStore } from "../store";

const DEFAULT_REPO = "https://github.com/Vendicated/Vencord";

function SettingCard({
    title,
    desc,
    children,
    note,
    actions
}: {
    title: string;
    desc?: ReactNode;
    children?: ReactNode;
    note?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <div className="card flush setting-card">
            <div className="setting-body">
                <h3 className="card-title">{title}</h3>
                {desc && <p className="setting-desc">{desc}</p>}
                {children && <div className="setting-content">{children}</div>}
            </div>
            {(note || actions) && (
                <div className="setting-foot">
                    <div className="grow small faint ellipsis">{note}</div>
                    {actions}
                </div>
            )}
        </div>
    );
}

function ToggleRow({ label, desc, on, onChange }: { label: string; desc: ReactNode; on: boolean; onChange(v: boolean): void }) {
    return (
        <div className="field">
            <div className="field-text">
                <div className="field-label">{label}</div>
                <div className="field-desc">{desc}</div>
            </div>
            <Switch on={on} onChange={onChange} />
        </div>
    );
}

export function SettingsPage() {
    const config = useStore(s => s.config);
    const vencord = useStore(s => s.vencord);
    const env = useStore(s => s.env);
    const toast = useStore(s => s.toast);
    const busy = useBusy();
    const [repo, setRepo] = useState("");
    const [branch, setBranch] = useState("");
    const [version, setVersion] = useState("");
    const [checkingApp, setCheckingApp] = useState(false);
    const appUpdate = useStore(s => s.appUpdate);

    const savedRepo = config?.repoUrl;
    const savedBranch = config?.repoBranch;

    useEffect(() => {
        window.vu.info().then(info => setVersion(info.version));
    }, []);

    useEffect(() => {
        if (savedRepo !== undefined) setRepo(savedRepo);
        if (savedBranch !== undefined) setBranch(savedBranch);
    }, [savedRepo, savedBranch]);

    if (!config) return null;

    const save = async (patch: EditableConfig, msg?: string) => {
        try {
            await window.vu.setConfig(patch);
            if (msg) toast({ kind: "success", title: msg });
        } catch (e) {
            toast({ kind: "error", title: (e as Error).message });
        }
    };

    const checkAppUpdate = async () => {
        setCheckingApp(true);
        const state = await window.vu.appUpdate.check();
        setCheckingApp(false);
        useStore.setState({ appUpdateDismissed: false });
        if (state.phase === "current") toast({ kind: "success", title: "Vencord Util is up to date" });
        else if (state.phase === "error") toast({ kind: "error", title: "Update check failed", text: state.error });
    };

    const appUpdateNote =
        appUpdate.phase === "available" && appUpdate.info
            ? `Version ${appUpdate.info.version} is available.`
            : appUpdate.checkedAt
              ? `Checked for updates ${timeAgo(appUpdate.checkedAt)}.`
              : "Updates are checked every time the app starts.";

    const repoChanged = repo.trim() !== config.repoUrl || branch.trim() !== config.repoBranch;
    const isDefaultRepo = config.repoUrl === DEFAULT_REPO && !config.repoBranch;

    return (
        <>
            <div className="page-header">
                <div>
                    <h1 className="page-title">Settings</h1>
                    <p className="page-sub">Location, source and build behaviour.</p>
                </div>
            </div>

            <div className="stack" style={{ gap: 16 }}>
                <SettingCard
                    title="Vencord location"
                    desc="The folder containing the cloned Vencord repository. You can also pick an existing clone."
                    note={vencord?.exists ? "Custom plugins live in src/userplugins." : "This folder does not exist yet – it is created during setup."}
                    actions={
                        <>
                            {vencord?.exists && (
                                <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => window.vu.openPath(config.vencordDir)}>
                                    Open
                                </Button>
                            )}
                            <Button size="sm" icon={FolderSearch} disabled={busy} onClick={() => window.vu.vencord.chooseDir()}>
                                Change
                            </Button>
                        </>
                    }
                >
                    <div className="path">{config.vencordDir}</div>
                </SettingCard>

                <SettingCard
                    title="Repository"
                    desc="Defaults to the official Vencord repository. You can use a fork instead – this applies to new clones."
                    note={vencord?.remote ? `Current remote: ${vencord.remote}${vencord.branch ? ` (${vencord.branch})` : ""}` : undefined}
                    actions={
                        <>
                            {!isDefaultRepo && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => save({ repoUrl: DEFAULT_REPO, repoBranch: "" }, "Reset to the official repository")}
                                >
                                    Reset
                                </Button>
                            )}
                            <Button
                                size="sm"
                                variant="primary"
                                disabled={!repoChanged || busy}
                                onClick={() => save({ repoUrl: repo.trim() || DEFAULT_REPO, repoBranch: branch.trim() }, "Repository saved")}
                            >
                                Save
                            </Button>
                        </>
                    }
                >
                    <div className="row">
                        <input
                            className="input"
                            style={{ flex: 3 }}
                            value={repo}
                            onChange={e => setRepo(e.target.value)}
                            placeholder={DEFAULT_REPO}
                            spellCheck={false}
                        />
                        <input
                            className="input"
                            style={{ flex: 1 }}
                            value={branch}
                            onChange={e => setBranch(e.target.value)}
                            placeholder="Branch (default)"
                            spellCheck={false}
                        />
                    </div>
                </SettingCard>

                <div className="card flush">
                    <ToggleRow
                        label="Restart Discord after building"
                        desc="After updates and builds, every Discord installation running source Vencord is restarted automatically."
                        on={config.restartDiscordAfterBuild}
                        onChange={v => save({ restartDiscordAfterBuild: v })}
                    />
                    <ToggleRow
                        label="Developer build"
                        desc={
                            <>
                                Builds with <code>pnpm build --dev</code> (includes the PatchHelper, among others). Recommended for plugin development only.
                            </>
                        }
                        on={config.devBuild}
                        onChange={v => save({ devBuild: v }, v ? "Developer build enabled – applies to the next build" : undefined)}
                    />
                </div>

                <SettingCard title="System" desc="Tools used to download and build Vencord.">
                    <div className="list">
                        {env &&
                            Object.values(env.tools).map(t => (
                                <div className="row" key={t.name} style={{ padding: "8px 0", borderTop: "1px solid var(--border-subtle)" }}>
                                    <span style={{ width: 80, fontWeight: 500 }}>{{ git: "Git", node: "Node.js", pnpm: "pnpm" }[t.name]}</span>
                                    <span className="mono small muted" style={{ width: 120 }}>
                                        {t.version ?? "–"}
                                    </span>
                                    <span className="mono small faint ellipsis grow" title={t.path}>
                                        {t.found ? t.path : "not found"}
                                    </span>
                                </div>
                            ))}
                    </div>
                </SettingCard>

                <SettingCard
                    title={`Vencord Util v${version}`}
                    desc="Unofficial helper app, not affiliated with the Vencord project. Vencord is made by Vendicated and contributors (GPL-3.0)."
                    note={appUpdateNote}
                    actions={
                        <>
                            <Button
                                size="sm"
                                variant="ghost"
                                icon={ExternalLink}
                                onClick={() => window.vu.openExternal("https://docs.vencord.dev/installing/")}
                            >
                                Vencord docs
                            </Button>
                            <Button size="sm" icon={RefreshCw} loading={checkingApp || appUpdate.phase === "checking"} onClick={checkAppUpdate}>
                                Check for updates
                            </Button>
                        </>
                    }
                />
            </div>
        </>
    );
}
