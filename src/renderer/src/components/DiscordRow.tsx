import type { DiscordInstall } from "@shared/types";
import { FolderInput, FolderOpen, MonitorSmartphone, Play, RotateCw, Syringe, Unplug } from "lucide-react";
import { act, useBusy, useStore } from "../store";
import { Badge, Button, confirmDialog, Menu, PatchBadge } from "./ui";

const iconTone = (kind: DiscordInstall["patch"]["kind"]) => {
    if (kind === "source") return "green";
    if (kind === "broken") return "red";
    return kind === "none" ? "" : "yellow";
};

export function DiscordRow({ install }: { install: DiscordInstall }) {
    const busy = useBusy();
    const built = useStore(s => s.vencord?.built);
    const toast = useStore(s => s.toast);
    const { patch } = install;
    const canInject = Boolean(built) && patch.kind !== "source";

    const inject = () => act(window.vu.discord.inject([install.id]), `Vencord injected into ${install.name}`);
    const restart = () => act(window.vu.discord.restart(install.id));

    const uninject = async () => {
        const confirmed = await confirmDialog({
            title: `Remove Vencord from ${install.name}?`,
            text: "Discord will be closed briefly and restored to its original state. Your Vencord settings are kept.",
            confirm: "Remove",
            danger: true
        });
        if (confirmed) act(window.vu.discord.uninject([install.id]), `Vencord was removed from ${install.name}`);
    };

    const adoptSourceDir = async () => {
        await window.vu.setConfig({ vencordDir: patch.sourceDir });
        toast({ kind: "success", title: "Vencord folder updated", text: patch.sourceDir });
    };

    return (
        <div className="list-item">
            <div className={`card-icon ${iconTone(patch.kind)}`}>
                <MonitorSmartphone size={16} />
            </div>
            <div className="grow">
                <div className="row wrap" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>{install.name}</span>
                    {install.version && <span className="faint small">v{install.version}</span>}
                    <PatchBadge kind={patch.kind} sourceDir={patch.sourceDir} />
                    {install.running && <Badge color="accent">Running</Badge>}
                </div>
                <div className="small faint ellipsis mono" title={patch.patcherPath ?? install.resourcesPath} style={{ marginTop: 3 }}>
                    {patch.patcherPath ? `→ ${patch.patcherPath}` : install.resourcesPath}
                </div>
            </div>
            <div className="row" style={{ gap: 4, flex: "none" }}>
                {canInject ? (
                    <Button size="sm" variant={patch.kind === "none" ? "primary" : "secondary"} icon={Syringe} disabled={busy} onClick={inject}>
                        {patch.kind === "none" ? "Inject" : "Switch to source"}
                    </Button>
                ) : (
                    <Button size="sm" icon={install.running ? RotateCw : Play} disabled={busy} onClick={restart}>
                        {install.running ? "Restart" : "Start"}
                    </Button>
                )}
                <Menu
                    disabled={busy}
                    items={[
                        { label: "Use this Vencord folder", icon: FolderInput, onClick: adoptSourceDir, hidden: !(patch.kind === "other" && patch.sourceDir) },
                        {
                            label: install.running ? "Restart Discord" : "Start Discord",
                            icon: install.running ? RotateCw : Play,
                            onClick: restart,
                            hidden: !canInject
                        },
                        { label: "Show in folder", icon: FolderOpen, onClick: () => window.vu.showItem(install.resourcesPath) },
                        { label: "Remove Vencord", icon: Unplug, onClick: uninject, danger: true, hidden: patch.kind === "none" }
                    ]}
                />
            </div>
        </div>
    );
}
