import type { PluginInstallOutcome, TaskResult } from "@shared/types";
import { act, useStore } from "./store";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function handleOutcome(result: TaskResult<PluginInstallOutcome>) {
    const { toast, setStage } = useStore.getState();
    if (!result.ok || !result.data) return;
    if (result.data.stage) {
        setStage(result.data.stage);
    } else if (result.data.installed.length) {
        toast({
            kind: "success",
            title: `Installed: ${result.data.installed.join(", ")}`,
            text: "Rebuild Vencord so Discord picks up the changes."
        });
    }
}

export async function installPluginUrl(url: string) {
    const result = await act(window.vu.plugins.addUrl(url));
    handleOutcome(result);
    return result.ok;
}

export async function installPluginPaths(paths: string[]) {
    if (!paths.length) return false;
    const result = await act(window.vu.plugins.addPaths(paths));
    handleOutcome(result);
    return result.ok;
}

function pathsFromTransfer(transfer: DataTransfer) {
    return Array.from(transfer.files)
        .map(file => {
            try {
                return window.vu.getPathForFile(file);
            } catch {
                return "";
            }
        })
        .filter(Boolean);
}

export async function handleDrop(transfer: DataTransfer) {
    const paths = pathsFromTransfer(transfer);
    if (paths.length) return installPluginPaths(paths);

    const link = (transfer.getData("text/uri-list") || transfer.getData("text/plain") || "")
        .split(/\r?\n/)
        .find(line => line && !line.startsWith("#"))
        ?.trim();
    if (link && /^https?:\/\//i.test(link)) return installPluginUrl(link);

    useStore.getState().toast({
        kind: "error",
        title: "This can't be installed as a plugin.",
        text: "Drop a folder, a .ts/.tsx/.zip file or a GitHub link."
    });
    return false;
}

export const buildAndRestart = (restart?: boolean) => act(window.vu.vencord.build(restart), "Vencord was built");

export async function checkUpdates(silent = false) {
    const result = await window.vu.vencord.checkUpdates();
    const { toast, refresh } = useStore.getState();
    if (!silent) {
        const failure = result.error ?? result.data?.error;
        if (failure) toast({ kind: "error", title: "Update check failed", text: failure });
        else {
            const behind = result.data?.behind ?? 0;
            toast({ kind: behind ? "info" : "success", title: behind ? `${plural(behind, "new commit")} available` : "Vencord is up to date" });
        }
    }
    await refresh("config");
    return result;
}

export async function checkPluginUpdates(silent = false) {
    const result = await window.vu.plugins.checkUpdates();
    if (!silent) {
        const { toast } = useStore.getState();
        if (!result.ok) toast({ kind: "error", title: "Plugin update check failed", text: result.error });
        else {
            const available = result.data ?? 0;
            toast({
                kind: available ? "info" : "success",
                title: available ? `${plural(available, "plugin update")} available` : "All plugins are up to date"
            });
        }
    }
    return result;
}
