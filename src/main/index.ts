import { app, BrowserWindow, nativeTheme } from "electron";
import { getConfig, setConfig } from "./core/config";
import { log, notifyChanged } from "./core/events";
import { refreshPath } from "./core/path";
import { cancelCurrentTask } from "./core/tasks";
import { findExistingSourceDir } from "./discord/discord";
import { registerIpc } from "./ipc";
import { cleanStaging } from "./plugins/staging";
import { checkAppUpdate } from "./updater";
import { isVencordRepo } from "./vencord/repo";
import { createMainWindow } from "./window";

async function adoptExistingClone() {
    const config = getConfig();
    if (config.onboarded || isVencordRepo(config.vencordDir)) return;
    const found = await findExistingSourceDir();
    if (!found) return;
    setConfig({ vencordDir: found, onboarded: true });
    log(`Found and adopted existing Vencord clone: ${found}`, "success");
    notifyChanged("config", "vencord", "plugins", "discord", "env");
}

function focusExistingWindow() {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
}

if (process.env.VU_USER_DATA_DIR) app.setPath("userData", process.env.VU_USER_DATA_DIR);

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on("second-instance", focusExistingWindow);

    app.whenReady().then(async () => {
        nativeTheme.themeSource = "dark";
        app.setAppUserModelId("com.vencordutil.app");
        cleanStaging();
        registerIpc();
        await refreshPath().catch(() => undefined);
        createMainWindow();
        adoptExistingClone().catch(error => console.error("Could not detect an existing Vencord clone", error));
        if (app.isPackaged || process.env.VU_UPDATE_MANIFEST_URL) checkAppUpdate();

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
        });
    });

    app.on("window-all-closed", () => {
        cancelCurrentTask();
        if (process.platform !== "darwin") app.quit();
    });
}
