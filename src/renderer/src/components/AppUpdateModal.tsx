import type { AppUpdateInfo } from "@shared/types";
import { AlertTriangle, ArrowDownToLine, ExternalLink, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useStore } from "../store";
import { Button, Modal, timeAgo } from "./ui";

const VISIBLE_PHASES = new Set(["available", "downloading", "installing", "error"]);

const formatMb = (bytes = 0) => `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;

function inline(text: string): ReactNode[] {
    // Splitting with a capture group puts inline code at every odd position.
    const nodes: ReactNode[] = [];
    let isCode = false;
    for (const part of text.replace(/\*\*(.+?)\*\*/g, "$1").split(/`([^`]+)`/)) {
        nodes.push(isCode ? <code key={`code-${nodes.length}`}>{part}</code> : part);
        isCode = !isCode;
    }
    return nodes;
}

/** Renders the subset of Markdown used in CHANGELOG.md: headings, bullet points, paragraphs and inline code. */
function ReleaseNotes({ text }: { text: string }) {
    return (
        <div className="release-notes selectable">
            {text.split(/\r?\n/).map((line, index) => {
                const key = `${index}-${line}`;
                if (!line.trim()) return null;
                if (/^#{1,6}\s/.test(line))
                    return (
                        <div key={key} className="rn-heading">
                            {inline(line.replace(/^#+\s*/, ""))}
                        </div>
                    );
                if (/^\s*[-*]\s/.test(line))
                    return (
                        <div key={key} className="rn-item">
                            {inline(line.replace(/^\s*[-*]\s/, ""))}
                        </div>
                    );
                return <p key={key}>{inline(line)}</p>;
            })}
        </div>
    );
}

function installNote(info: AppUpdateInfo) {
    switch (info.install) {
        case "setup":
            return "The update is downloaded and installed in the background. Vencord Util restarts afterwards.";
        case "portable":
            return "The new version is saved next to this file and started automatically. You can delete the old file afterwards.";
        case "dmg":
            return "The disk image is saved to Downloads and opened. Drag Vencord Util into Applications to replace this version.";
        default:
            return "Automatic installation is not available for this build – the download page opens in your browser.";
    }
}

export function AppUpdateModal() {
    const update = useStore(s => s.appUpdate);
    const dismissed = useStore(s => s.appUpdateDismissed);
    const toast = useStore(s => s.toast);
    const info = update.info;

    if (!info || !VISIBLE_PHASES.has(update.phase) || (dismissed && !info.mandatory)) return null;

    const busy = update.phase === "downloading" || update.phase === "installing";
    const progress = update.total ? Math.min(100, ((update.received ?? 0) / update.total) * 100) : 0;
    const close = () => {
        if (!busy && !info.mandatory) useStore.setState({ appUpdateDismissed: true });
    };
    const install = async () => {
        const result = await window.vu.appUpdate.install();
        if (!result.ok && result.error) toast({ kind: "error", title: "Update failed", text: result.error });
    };

    const primaryLabel =
        update.phase === "downloading"
            ? `Downloading … ${Math.round(progress)}%`
            : update.phase === "installing"
              ? "Installing …"
              : info.install === "manual"
                ? "Open download page"
                : update.phase === "error"
                  ? "Try again"
                  : "Update now";

    return (
        <Modal
            title={info.mandatory ? "Update required" : "Update available"}
            onClose={close}
            width={580}
            footer={
                <>
                    <Button variant="ghost" icon={ExternalLink} onClick={() => window.vu.openExternal(info.pageUrl)}>
                        Release page
                    </Button>
                    <div className="grow" />
                    {info.mandatory ? (
                        <Button variant="ghost" disabled={busy} onClick={() => window.vu.quit()}>
                            Quit
                        </Button>
                    ) : (
                        <Button variant="ghost" disabled={busy} onClick={close}>
                            Later
                        </Button>
                    )}
                    <Button variant="primary" icon={info.install === "manual" ? ExternalLink : ArrowDownToLine} loading={busy} onClick={install} autoFocus>
                        {primaryLabel}
                    </Button>
                </>
            }
        >
            <div className="row" style={{ gap: 12, margin: "6px 0 16px" }}>
                <div className="card-icon accent">
                    <Sparkles size={16} />
                </div>
                <div className="grow">
                    <div style={{ fontWeight: 600, color: "var(--text)" }}>Vencord Util {info.version}</div>
                    <div className="small faint">
                        You have {info.current}
                        {info.releaseDate ? ` · released ${timeAgo(info.releaseDate)}` : ""}
                        {info.size ? ` · ${formatMb(info.size)}` : ""}
                    </div>
                </div>
            </div>

            {info.mandatory && (
                <div className="callout red" style={{ marginBottom: 14 }}>
                    <AlertTriangle size={15} />
                    <div>This version is no longer supported. Update to {info.minimumVersion} or newer to keep using Vencord Util.</div>
                </div>
            )}

            {info.notes && <ReleaseNotes text={info.notes} />}

            {busy && (
                <div style={{ marginTop: 16 }}>
                    <div className="progress" style={{ height: 4 }}>
                        <div style={{ width: `${update.phase === "installing" ? 100 : progress}%` }} />
                    </div>
                    <div className="small faint" style={{ marginTop: 6 }}>
                        {update.phase === "installing" ? "Starting the installer …" : `${formatMb(update.received)} of ${formatMb(update.total)}`}
                    </div>
                </div>
            )}

            {update.phase === "error" && update.error && (
                <div className="callout red selectable" style={{ marginTop: 14 }}>
                    <AlertTriangle size={15} />
                    <div>{update.error}</div>
                </div>
            )}

            <p className="small faint" style={{ margin: "14px 0 0" }}>
                {installNote(info)}
            </p>
        </Modal>
    );
}
