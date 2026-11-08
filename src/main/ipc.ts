import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { IpcArgs, IpcChannel, IpcResult } from "@shared/ipc";
import type { EditableConfig, TaskResult } from "@shared/types";
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, type OpenDialogOptions, shell } from "electron";
import { getConfig, setConfig } from "./core/config";
import { UserError } from "./core/errors";
import { clearLogs, getLogs, notifyChanged } from "./core/events";
import { refreshPath } from "./core/path";
import { cancelCurrentTask, getCurrentTask, isBusy } from "./core/tasks";
import { getEnvStatus } from "./core/tools";
import { listDiscordInstalls } from "./discord/discord";
import { listPlugins, removePlugin, setPluginEnabled } from "./plugins/library";
import { commitStaging, discardStaging } from "./plugins/staging";
import { checkPluginUpdates } from "./plugins/updates";
import { checkAppUpdate, getAppUpdateState, installAppUpdate } from "./updater";
import { getCompatReport } from "./vencord/compatReport";
import { checkVencordUpdates, getVencordStatus, isVencordRepo } from "./vencord/repo";
import * as workflows from "./workflows";

type Handler<C extends IpcChannel> = (...args: IpcArgs<C>) => IpcResult<C> | Promise<IpcResult<C>>;

const EDITABLE_KEYS: (keyof EditableConfig)[] = ["vencordDir", "repoUrl", "repoBranch", "devBuild", "restartDiscordAfterBuild", "targets"];

function handle<C extends IpcChannel>(channel: C, handler: Handler<C>) {
    ipcMain.handle(channel, (_event: IpcMainInvokeEvent, ...args: unknown[]) => handler(...(args as IpcArgs<C>)));
}

async function attempt<T>(action: () => T | Promise<T>): Promise<TaskResult<Awaited<T>>> {
    try {
        return { ok: true, data: await action() };
    } catch (error) {
        return { ok: false, error: (error as Error).message, hint: error instanceof UserError ? error.hint : undefined };
    }
}

async function showOpenDialog(options: OpenDialogOptions) {
    const window = BrowserWindow.getFocusedWindow();
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
}

function updateConfig(patch: EditableConfig) {
    const clean: EditableConfig = Object.fromEntries(Object.entries(patch).filter(([key]) => EDITABLE_KEYS.includes(key as keyof EditableConfig)));
    if (clean.vencordDir !== undefined && !isAbsolute(clean.vencordDir)) throw new UserError("The path must be absolute.");
    const next = setConfig(clean);
    notifyChanged("config", "vencord", "plugins", "discord");
    return next;
}

async function chooseVencordDir() {
    const [picked] = await showOpenDialog({ title: "Choose Vencord location", buttonLabel: "Select", properties: ["openDirectory", "createDirectory"] });
    if (!picked) return null;
    const usable = isVencordRepo(picked) || !existsSync(picked) || readdirSync(picked).length === 0;
    const dir = usable ? picked : join(picked, "Vencord");
    setConfig({ vencordDir: dir });
    notifyChanged("config", "vencord", "plugins", "discord", "env");
    return dir;
}

function pickPluginFiles(mode: "file" | "folder") {
    return showOpenDialog(
        mode === "folder"
            ? { title: "Select plugin folder", properties: ["openDirectory", "multiSelections"] }
            : {
                  title: "Select plugin file",
                  properties: ["openFile", "multiSelections"],
                  filters: [{ name: "Vencord plugins", extensions: ["ts", "tsx", "js", "jsx", "zip"] }]
              }
    );
}

export function registerIpc() {
    handle("app:info", () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged }));
    handle("app:quit", () => app.quit());
    handle("appUpdate:state", getAppUpdateState);
    handle("appUpdate:check", checkAppUpdate);
    handle("appUpdate:install", () => attempt(installAppUpdate));
    handle("config:get", getConfig);
    handle("config:set", updateConfig);
    handle("logs:get", getLogs);
    handle("logs:clear", clearLogs);
    handle("task:current", getCurrentTask);
    handle("task:cancel", cancelCurrentTask);

    handle("shell:openPath", path => (existsSync(path) ? shell.openPath(path) : "Path does not exist"));
    handle("shell:showItem", path => shell.showItemInFolder(path));
    handle("shell:openExternal", url => {
        if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) links can be opened.");
        return shell.openExternal(url);
    });
    handle("dialog:pickPlugin", pickPluginFiles);

    handle("env:status", async () => {
        await refreshPath();
        return getEnvStatus();
    });
    handle("env:install", workflows.installToolTask);

    handle("discord:list", listDiscordInstalls);
    handle("discord:inject", workflows.injectTask);
    handle("discord:uninject", workflows.uninjectTask);
    handle("discord:restart", workflows.restartDiscordTask);

    handle("vencord:status", getVencordStatus);
    handle("vencord:chooseDir", chooseVencordDir);
    handle("vencord:install", workflows.installVencordTask);
    handle("vencord:deps", workflows.installDependenciesTask);
    handle("vencord:build", workflows.buildTask);
    handle("vencord:checkUpdates", () => attempt(checkVencordUpdates));
    handle("vencord:update", options => workflows.updateVencordTask(Boolean(options?.stash)));
    handle("vencord:compat", () => getCompatReport().catch(() => null));

    handle("plugins:list", listPlugins);
    handle("plugins:addUrl", workflows.addPluginFromUrlTask);
    handle("plugins:addPaths", workflows.addPluginFromPathsTask);
    handle("plugins:commit", (stagingId, ids) => attempt(() => commitStaging(stagingId, ids)));
    handle("plugins:discard", discardStaging);
    handle("plugins:remove", id => attempt(() => removePlugin(id)));
    handle("plugins:setEnabled", (id, enabled) => attempt(() => setPluginEnabled(id, enabled)));
    handle("plugins:checkUpdates", () => (isBusy() ? { ok: false, error: "Please wait until the current task has finished." } : attempt(checkPluginUpdates)));
    handle("plugins:update", workflows.updatePluginTask);
    handle("plugins:updateAll", workflows.updateAllPluginsTask);
    handle("plugins:linkSource", workflows.linkPluginSourceTask);
}
