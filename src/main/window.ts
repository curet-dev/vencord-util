import { join } from "node:path";
import { BrowserWindow, shell } from "electron";

const BACKGROUND = "#000000";
const TITLE_BAR_HEIGHT = 48;

export function createMainWindow() {
    const isMac = process.platform === "darwin";
    const window = new BrowserWindow({
        width: 1180,
        height: 780,
        minWidth: 920,
        minHeight: 620,
        show: false,
        backgroundColor: BACKGROUND,
        title: "Vencord Util",
        titleBarStyle: "hidden",
        ...(isMac ? { trafficLightPosition: { x: 18, y: 17 } } : { titleBarOverlay: { color: BACKGROUND, symbolColor: "#a1a1a1", height: TITLE_BAR_HEIGHT } }),
        icon: join(__dirname, "../../build/icon.png"),
        webPreferences: {
            preload: join(__dirname, "../preload/index.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false
        }
    });

    window.once("ready-to-show", () => window.show());
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
        if (url !== window.webContents.getURL()) event.preventDefault();
    });

    if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL);
    else window.loadFile(join(__dirname, "../renderer/index.html"));
    return window;
}
