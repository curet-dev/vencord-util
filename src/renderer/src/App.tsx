import { Terminal, UploadCloud } from "lucide-react";
import { Component, type ComponentType, type ReactNode, useEffect, useRef, useState } from "react";
import { handleDrop } from "./actions";
import { PluginSelectModal } from "./components/PluginSelectModal";
import { LogDrawer, TaskPill } from "./components/TaskView";
import { Button, ConfirmHost, Toasts } from "./components/ui";
import { ConsolePage } from "./pages/Console";
import { DashboardPage } from "./pages/Dashboard";
import { InstallPage } from "./pages/Install";
import { PluginsPage } from "./pages/Plugins";
import { SettingsPage } from "./pages/Settings";
import { initStore, type Page, useStore } from "./store";

const PAGES: Record<Page, ComponentType> = {
    dashboard: DashboardPage,
    install: InstallPage,
    plugins: PluginsPage,
    console: ConsolePage,
    settings: SettingsPage
};

export function Logo({ size = 22 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Vencord Util">
            <path d="M2.5 4H7.3L14.4 16.7L12 21Z" fill="var(--p-500)" />
            <path d="M21.5 4H16.7L9.6 16.7L12 21Z" fill="var(--p-300)" />
            <path d="M12 12.41L14.4 16.7L12 21L9.6 16.7Z" fill="var(--p-700)" />
        </svg>
    );
}

class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
    override state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    override render() {
        if (!this.state.error) return this.props.children;
        return (
            <div className="callout red selectable">
                <div className="grow">
                    <div style={{ fontWeight: 600 }}>This page could not be displayed.</div>
                    <div className="mono small" style={{ marginTop: 6, opacity: 0.85 }}>
                        {this.state.error.message}
                    </div>
                    <Button size="sm" style={{ marginTop: 12 }} onClick={() => this.setState({ error: null })}>
                        Try again
                    </Button>
                </div>
            </div>
        );
    }
}

function Slash() {
    return (
        <svg className="crumb-slash" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="M10.5 2.5 5.5 13.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
    );
}

function Topbar() {
    const vencord = useStore(s => s.vencord);
    const logOpen = useStore(s => s.logOpen);
    const setLogOpen = useStore(s => s.setLogOpen);

    return (
        <header className="topbar">
            <div className="crumbs">
                <div className="crumb-brand">
                    <Logo />
                    Vencord Util
                </div>
                <Slash />
                <div className="crumb">
                    {vencord?.isVencord ? (
                        <>
                            <span>Vencord</span>
                            {vencord.version && <span className="faint">v{vencord.version}</span>}
                            {vencord.branch && (
                                <span className="badge no-dot" style={{ height: 20 }}>
                                    {vencord.branch}
                                </span>
                            )}
                        </>
                    ) : (
                        <span className="faint">Not installed</span>
                    )}
                </div>
            </div>
            <div className="grow" />
            <TaskPill />
            <Button size="sm" variant="ghost" iconOnly icon={Terminal} title={logOpen ? "Hide output" : "Show output"} onClick={() => setLogOpen(!logOpen)} />
        </header>
    );
}

function Tab({ page, children, badge }: { page: Page; children: ReactNode; badge?: ReactNode }) {
    const active = useStore(s => s.page === page);
    const setPage = useStore(s => s.setPage);
    return (
        <button type="button" className={`tab${active ? " active" : ""}`} onClick={() => setPage(page)}>
            <span className="tab-inner">
                {children}
                {badge}
            </span>
        </button>
    );
}

function pluginTabBadge(needsRebuild: boolean, pluginUpdates: number, pluginCount: number) {
    if (needsRebuild) return <span className="dot warn" title="Rebuild required" />;
    if (pluginUpdates) return <span className="dot" title={`${pluginUpdates} plugin updates available`} />;
    return pluginCount ? <span className="count">{pluginCount}</span> : null;
}

function Tabs() {
    const pluginCount = useStore(s => s.plugins.length);
    const pluginUpdates = useStore(s => s.plugins.filter(plugin => plugin.update?.available).length);
    const needsRebuild = useStore(s => Boolean(s.config?.needsRebuild));
    const vencordUpdates = useStore(s => s.config?.lastUpdate?.behind ?? 0);
    const vencord = useStore(s => s.vencord);
    const installed = vencord?.isVencord && vencord.built;

    return (
        <nav className="tabs">
            <Tab page="dashboard" badge={vencordUpdates > 0 && <span className="dot" title="Updates available" />}>
                Overview
            </Tab>
            <Tab page="install" badge={vencord && !installed && <span className="dot" title="Not installed yet" />}>
                Install
            </Tab>
            <Tab page="plugins" badge={pluginTabBadge(needsRebuild, pluginUpdates, pluginCount)}>
                Plugins
            </Tab>
            <Tab page="console">Console</Tab>
            <Tab page="settings">Settings</Tab>
        </nav>
    );
}

const carriesPayload = (event: DragEvent) => {
    const types = Array.from(event.dataTransfer?.types ?? []);
    return types.includes("Files") || types.includes("text/uri-list");
};

function useWindowDrop() {
    const [active, setActive] = useState(false);
    const depth = useRef(0);

    useEffect(() => {
        const onEnter = (event: DragEvent) => {
            if (!carriesPayload(event)) return;
            event.preventDefault();
            depth.current++;
            setActive(true);
        };
        const onLeave = (event: DragEvent) => {
            if (!carriesPayload(event)) return;
            depth.current = Math.max(0, depth.current - 1);
            if (depth.current === 0) setActive(false);
        };
        const onOver = (event: DragEvent) => {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        };
        const onDrop = (event: DragEvent) => {
            event.preventDefault();
            depth.current = 0;
            setActive(false);
            if (!event.dataTransfer || !carriesPayload(event)) return;
            useStore.getState().setPage("plugins");
            handleDrop(event.dataTransfer);
        };

        const listeners = { dragenter: onEnter, dragleave: onLeave, dragover: onOver, drop: onDrop } as const;
        for (const [type, listener] of Object.entries(listeners)) window.addEventListener(type, listener as EventListener);
        return () => {
            for (const [type, listener] of Object.entries(listeners)) window.removeEventListener(type, listener as EventListener);
        };
    }, []);

    return active;
}

export function App() {
    const page = useStore(s => s.page);
    const dropActive = useWindowDrop();
    const CurrentPage = PAGES[page];

    useEffect(() => initStore(), []);

    return (
        <div className={`app platform-${window.vu.platform}`}>
            <Topbar />
            <Tabs />
            <main className="main">
                <div className="content" key={page}>
                    <div className="content-inner">
                        <PageBoundary>
                            <CurrentPage />
                        </PageBoundary>
                    </div>
                </div>
                <LogDrawer />
            </main>
            {dropActive && (
                <div className="drop-overlay">
                    <div className="box">
                        <div className="dropzone-icon">
                            <UploadCloud size={20} />
                        </div>
                        <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>Drop to install</div>
                        <div className="muted small" style={{ marginTop: 4 }}>
                            Folder, .ts/.tsx file, .zip or GitHub link
                        </div>
                    </div>
                </div>
            )}
            <PluginSelectModal />
            <ConfirmHost />
            <Toasts />
        </div>
    );
}
