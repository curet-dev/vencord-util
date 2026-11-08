import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppUpdateInstallKind, AppUpdateState } from "@shared/types";
import { app, net, shell } from "electron";
import { emit, log } from "./core/events";
import { evaluateUpdate, type ManifestFile, parseManifest, RELEASE_REPO } from "./updateManifest";

const DEFAULT_MANIFEST_URL = `https://github.com/${RELEASE_REPO}/releases/latest/download/update.json`;
// Development builds can point the check at a test manifest, e.g. VU_UPDATE_MANIFEST_URL=http://127.0.0.1:8123/update.json
const manifestUrl = () => (!app.isPackaged && process.env.VU_UPDATE_MANIFEST_URL) || DEFAULT_MANIFEST_URL;
const USER_AGENT = `VencordUtil (+https://github.com/${RELEASE_REPO})`;
const MAX_UPDATE_BYTES = 800 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 150;
const QUIT_DELAY_MS = 400;

let state: AppUpdateState = { phase: "idle" };
let selectedFile: ManifestFile | undefined;

function setState(next: AppUpdateState) {
    state = next;
    emit({ type: "appUpdate", state });
}

export const getAppUpdateState = () => state;

function installKind(): AppUpdateInstallKind {
    if (!app.isPackaged) return "manual";
    if (process.platform === "win32") return process.env.PORTABLE_EXECUTABLE_FILE ? "portable" : "setup";
    return process.platform === "darwin" ? "dmg" : "manual";
}

const isBusy = () => state.phase === "checking" || state.phase === "downloading" || state.phase === "installing";

export async function checkAppUpdate(): Promise<AppUpdateState> {
    if (isBusy()) return state;
    setState({ ...state, phase: "checking", error: undefined });
    try {
        const response = await net.fetch(manifestUrl(), { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
        // Releases published before the updater existed have no update.json.
        if (response.status === 404) {
            setState({ phase: "current", checkedAt: Date.now() });
            return state;
        }
        if (!response.ok) throw new Error(`GitHub answered with ${response.status} ${response.statusText}`.trim());

        const result = evaluateUpdate(parseManifest(await response.json()), app.getVersion(), installKind(), process.platform, process.arch);
        selectedFile = result?.file;
        setState(result ? { phase: "available", info: result.info, checkedAt: Date.now() } : { phase: "current", checkedAt: Date.now() });
        if (result) log(`Vencord Util ${result.info.version} is available (installed: ${result.info.current}).`, "info");
    } catch (error) {
        setState({ phase: "error", error: `Update check failed: ${(error as Error).message}`, checkedAt: Date.now() });
    }
    return state;
}

function downloadTarget(kind: AppUpdateInstallKind, name: string) {
    if (kind === "portable" && process.env.PORTABLE_EXECUTABLE_FILE) return join(dirname(process.env.PORTABLE_EXECUTABLE_FILE), name);
    if (kind === "dmg") return join(app.getPath("downloads"), name);
    return join(app.getPath("temp"), "vencord-util-update", name);
}

async function download(url: string, target: string, file: ManifestFile, onProgress: (received: number) => void) {
    const partial = `${target}.download`;
    mkdirSync(dirname(target), { recursive: true });
    const response = await net.fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status} ${response.statusText})`.trim());

    const hash = createHash("sha512");
    const output = createWriteStream(partial);
    const reader = response.body.getReader();
    let received = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > MAX_UPDATE_BYTES || received > file.size) throw new Error("The download is larger than announced.");
            hash.update(value);
            if (!output.write(value)) await once(output, "drain");
            onProgress(received);
        }
        await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => (error ? reject(error) : resolve())));
        if (received !== file.size) throw new Error("The download is incomplete.");
        if (hash.digest("base64") !== file.sha512) throw new Error("The download is damaged (checksum mismatch).");
        rmSync(target, { force: true });
        renameSync(partial, target);
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        output.destroy();
        rmSync(partial, { force: true });
        throw error;
    }
}

function launchAndQuit(kind: AppUpdateInstallKind, path: string) {
    if (kind === "dmg") {
        shell.openPath(path);
    } else {
        // The new process must not find this instance still holding the single-instance lock.
        app.releaseSingleInstanceLock();
        // "/S" installs silently into the existing location, "--updated" keeps shortcuts, "--force-run" starts the app afterwards.
        const args = kind === "setup" ? ["--updated", "/S", "--force-run"] : [];
        spawn(path, args, { detached: true, stdio: "ignore" }).unref();
    }
    setTimeout(() => app.quit(), QUIT_DELAY_MS);
}

export async function installAppUpdate(): Promise<void> {
    const { info } = state;
    if (!info || isBusy()) throw new Error("No update is ready to install.");
    if (info.install === "manual" || !selectedFile) {
        await shell.openExternal(info.pageUrl);
        return;
    }

    const file = selectedFile;
    const url = `https://github.com/${RELEASE_REPO}/releases/download/v${info.version}/${encodeURIComponent(file.name)}`;
    const target = downloadTarget(info.install, file.name);
    if (existsSync(target) && target === process.env.PORTABLE_EXECUTABLE_FILE) throw new Error("The new version would overwrite the running file.");

    let lastProgress = 0;
    setState({ ...state, phase: "downloading", received: 0, total: file.size, error: undefined });
    try {
        log(`Downloading ${file.name} …`, "info");
        await download(url, target, file, received => {
            if (Date.now() - lastProgress < PROGRESS_INTERVAL_MS) return;
            lastProgress = Date.now();
            setState({ ...state, received });
        });
        setState({ ...state, phase: "installing", received: file.size });
        log(`Installing Vencord Util ${info.version} …`, "success");
        launchAndQuit(info.install, target);
    } catch (error) {
        setState({ ...state, phase: "error", error: (error as Error).message });
        throw error;
    }
}
