import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { DiscordBranch, DiscordInstall, PatchInfo } from "@shared/types";
import rawFs from "original-fs";
import { getConfig } from "../core/config";
import { UserError } from "../core/errors";
import { tryExec } from "../core/exec";
import type { TaskContext } from "../core/tasks";
import { isVencordRepo } from "../vencord/repo";
import { detectPatch, patchResources, unpatchResources } from "./patcher";

type InstallLocation = Omit<DiscordInstall, "patch" | "running">;

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const BRANCHES: DiscordBranch[] = ["stable", "ptb", "canary", "development"];
const CLOSE_POLL_MS = 400;
const CLOSE_ATTEMPTS = 30;
const FORCE_KILL_AFTER = 12;

const WINDOWS_DIRS: Record<DiscordBranch, string> = {
    stable: "Discord",
    ptb: "DiscordPTB",
    canary: "DiscordCanary",
    development: "DiscordDevelopment"
};

const MAC_APPS: Record<DiscordBranch, string> = {
    stable: "Discord.app",
    ptb: "Discord PTB.app",
    canary: "Discord Canary.app",
    development: "Discord Development.app"
};

const LABELS: Record<DiscordBranch, string> = {
    stable: "Discord",
    ptb: "Discord PTB",
    canary: "Discord Canary",
    development: "Discord Development"
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const samePath = (a: string, b: string) => {
    const [left, right] = [resolve(a), resolve(b)];
    return isWindows ? left.toLowerCase() === right.toLowerCase() : left === right;
};

function compareVersions(a: string, b: string) {
    const left = a.split(".").map(part => Number.parseInt(part, 10) || 0);
    const right = b.split(".").map(part => Number.parseInt(part, 10) || 0);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const diff = (left[i] ?? 0) - (right[i] ?? 0);
        if (diff) return diff;
    }
    return 0;
}

function findWindowsInstalls(): InstallLocation[] {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return [];

    return BRANCHES.flatMap(branch => {
        const base = join(localAppData, WINDOWS_DIRS[branch]);
        let entries: string[];
        try {
            entries = rawFs.readdirSync(base);
        } catch {
            return [];
        }
        const latest = entries
            .filter(name => name.startsWith("app-") && rawFs.existsSync(join(base, name, "resources")))
            .map(name => name.slice(4))
            .sort(compareVersions)
            .at(-1);
        if (!latest) return [];
        return [{ id: base, branch, name: LABELS[branch], path: base, resourcesPath: join(base, `app-${latest}`, "resources"), version: latest }];
    });
}

function readBundleVersion(app: string) {
    try {
        const plist = rawFs.readFileSync(join(app, "Contents", "Info.plist"), "utf8");
        return plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
    } catch {
        return undefined;
    }
}

function findMacInstalls(): InstallLocation[] {
    return ["/Applications", join(homedir(), "Applications")].flatMap(base =>
        BRANCHES.flatMap(branch => {
            const app = join(base, MAC_APPS[branch]);
            const resources = join(app, "Contents", "Resources");
            const valid = rawFs.existsSync(join(resources, "app.asar")) || rawFs.existsSync(join(resources, "_app.asar"));
            if (!valid) return [];
            return [{ id: app, branch, name: LABELS[branch], path: app, resourcesPath: resources, version: readBundleVersion(app) }];
        })
    );
}

function officialDataDirs() {
    const home = homedir();
    const dirs = [join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "Vencord")];
    if (isWindows && process.env.APPDATA) dirs.push(join(process.env.APPDATA, "Vencord"));
    if (isMac) dirs.push(join(home, "Library", "Application Support", "Vencord"));
    return dirs;
}

export const sourcePatcherPath = () => join(getConfig().vencordDir, "dist", "patcher.js");

function classify(patcherPath: string | null): PatchInfo {
    if (!patcherPath) return { kind: "other" };
    const exists = rawFs.existsSync(patcherPath);
    if (samePath(patcherPath, sourcePatcherPath())) return { kind: exists ? "source" : "broken", patcherPath };
    if (!exists) return { kind: "broken", patcherPath };
    if (officialDataDirs().some(dir => samePath(patcherPath, join(dir, "dist", "patcher.js")))) return { kind: "official", patcherPath };
    const repo = dirname(dirname(patcherPath));
    return { kind: "other", patcherPath, sourceDir: isVencordRepo(repo) ? repo : undefined };
}

async function runningProcesses() {
    const result = isWindows
        ? await tryExec("tasklist", ["/FO", "CSV", "/NH"], { timeoutMs: 10_000 })
        : await tryExec("ps", ["-axo", "command="], { timeoutMs: 10_000 });
    return isWindows ? (result?.stdout ?? "").toLowerCase() : (result?.stdout ?? "");
}

const macExecutableDir = (install: InstallLocation) => `${join(install.path, "Contents", "MacOS")}/`;

function isRunningIn(processes: string, install: InstallLocation) {
    return isWindows ? processes.includes(`"${WINDOWS_DIRS[install.branch].toLowerCase()}.exe"`) : processes.includes(macExecutableDir(install));
}

const isRunning = async (install: InstallLocation) => isRunningIn(await runningProcesses(), install);

export async function listDiscordInstalls(): Promise<DiscordInstall[]> {
    const locations = isWindows ? findWindowsInstalls() : isMac ? findMacInstalls() : [];
    const processes = await runningProcesses();
    return locations.map(location => ({
        ...location,
        patch: detectPatch(location.resourcesPath, classify),
        running: isRunningIn(processes, location)
    }));
}

export async function getInstall(id: string) {
    const install = (await listDiscordInstalls()).find(candidate => samePath(candidate.id, id));
    if (!install) throw new UserError("This Discord installation could not be found.", "Refresh the list and try again.");
    return install;
}

export async function findExistingSourceDir() {
    const fromPatches = (await listDiscordInstalls()).flatMap(install => (install.patch.sourceDir ? [install.patch.sourceDir] : []));
    const home = homedir();
    const common = ["Documents", ".", "Desktop", "Projects"].map(dir => join(home, dir, "Vencord"));
    return [...fromPatches, ...common].find(isVencordRepo) ?? null;
}

export async function closeDiscord(install: DiscordInstall, ctx?: TaskContext) {
    if (!(await isRunning(install))) return false;
    ctx?.log(`Closing ${install.name} …`);

    if (isWindows) await tryExec("taskkill", ["/F", "/T", "/IM", `${WINDOWS_DIRS[install.branch]}.exe`]);
    else await tryExec("pkill", ["-TERM", "-f", macExecutableDir(install)]);

    for (let attempt = 1; attempt <= CLOSE_ATTEMPTS; attempt++) {
        await sleep(CLOSE_POLL_MS);
        if (!(await isRunning(install))) {
            await sleep(isWindows ? 800 : 300);
            return true;
        }
        if (isMac && attempt === FORCE_KILL_AFTER) await tryExec("pkill", ["-KILL", "-f", macExecutableDir(install)]);
    }
    throw new UserError(`Could not close ${install.name}.`, "Close Discord manually (including the system tray / Dock) and try again.");
}

export function launchDiscord(install: DiscordInstall) {
    if (!isWindows) {
        spawn("open", ["-a", install.path], { detached: true, stdio: "ignore" }).unref();
        return;
    }
    const executable = `${WINDOWS_DIRS[install.branch]}.exe`;
    const updater = join(install.path, "Update.exe");
    const [command, args] = rawFs.existsSync(updater) ? [updater, ["--processStart", executable]] : [join(dirname(install.resourcesPath), executable), []];
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

export async function injectVencord(install: DiscordInstall, ctx: TaskContext) {
    await patchResources(install.resourcesPath, sourcePatcherPath(), classify, ctx.log);
    ctx.log(`${install.name}: Vencord injected → ${sourcePatcherPath()}`, "success");
}

export async function removeVencord(install: DiscordInstall, ctx: TaskContext) {
    await unpatchResources(install.resourcesPath, ctx.log);
    ctx.log(`${install.name}: Vencord patch removed.`, "success");
}
