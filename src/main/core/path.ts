import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { paths } from "./config";

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const PATH_MARKER = "__VU_PATH__";

let resolvedPath = process.env.PATH ?? process.env.Path ?? "";

export const toolsBinDir = () => join(paths.tools, "node_modules", ".bin");

function normalizeEntry(entry: string) {
    const trimmed = entry
        .trim()
        .replace(/^"|"$/g, "")
        .replace(/[\\/]+$/, "");
    return isWindows ? trimmed.toLowerCase() : trimmed;
}

function uniquePaths(entries: string[]) {
    const seen = new Set<string>();
    return entries
        .map(entry => entry.trim().replace(/^"|"$/g, ""))
        .filter(entry => {
            const key = normalizeEntry(entry);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function expandWindowsVariables(value: string) {
    return value.replace(/%([^%]+)%/g, (match, name: string) => {
        const key = Object.keys(process.env).find(k => k.toLowerCase() === name.toLowerCase());
        return key ? (process.env[key] ?? match) : match;
    });
}

function capture(command: string, args: string[], timeoutMs = 8000): Promise<string> {
    return new Promise(resolve => {
        let output = "";
        const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
        const timer = setTimeout(() => child.kill(), timeoutMs);
        child.stdout.on("data", chunk => {
            output += chunk.toString();
        });
        child.on("error", () => resolve(""));
        child.on("close", () => {
            clearTimeout(timer);
            resolve(output);
        });
    });
}

async function readWindowsRegistryPath() {
    const readKey = async (key: string) => {
        const output = await capture("reg", ["query", key, "/v", "Path"]);
        const match = output.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
        return match ? expandWindowsVariables(match[1].trim()).split(";") : [];
    };
    const [machine, user] = await Promise.all([
        readKey("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"),
        readKey("HKCU\\Environment")
    ]);
    return [...machine, ...user];
}

async function readLoginShellPath() {
    const shell = process.env.SHELL || "/bin/zsh";
    const output = await capture(shell, ["-ilc", `printf '${PATH_MARKER}%s${PATH_MARKER}' "$PATH"`], 6000);
    const match = output.match(new RegExp(`${PATH_MARKER}(.*)${PATH_MARKER}`));
    return match ? match[1].split(":") : [];
}

function compareVersionsDesc(a: string, b: string) {
    const left = a.replace(/^v/, "").split(".").map(Number);
    const right = b.replace(/^v/, "").split(".").map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const diff = (right[i] ?? 0) - (left[i] ?? 0);
        if (diff) return diff;
    }
    return 0;
}

function latestNvmBin(home: string) {
    const versionsDir = join(home, ".nvm", "versions", "node");
    try {
        const [latest] = readdirSync(versionsDir).sort(compareVersionsDesc);
        return latest ? [join(versionsDir, latest, "bin")] : [];
    } catch {
        return [];
    }
}

function wellKnownPaths() {
    const home = homedir();
    if (isWindows) {
        const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
        const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
        const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
        return [
            join(programFiles, "Git", "cmd"),
            join(programFiles, "nodejs"),
            join(appData, "npm"),
            join(localAppData, "pnpm"),
            join(localAppData, "Programs", "Git", "cmd")
        ];
    }
    return [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        join(home, ".volta", "bin"),
        join(home, ".local", "bin"),
        join(home, "Library", "pnpm"),
        join(home, ".local", "share", "pnpm"),
        join(home, ".bun", "bin"),
        ...latestNvmBin(home)
    ];
}

async function readSystemPath() {
    try {
        if (isWindows) return await readWindowsRegistryPath();
        if (isMac) return await readLoginShellPath();
    } catch {
        return [];
    }
    return [];
}

export async function refreshPath() {
    const current = (process.env.PATH ?? process.env.Path ?? "").split(delimiter);
    const ownTools = existsSync(toolsBinDir()) ? [toolsBinDir()] : [];
    resolvedPath = uniquePaths([...ownTools, ...(await readSystemPath()), ...current, ...wellKnownPaths()]).join(delimiter);
    return resolvedPath;
}

export function getSpawnEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (key.toLowerCase() === "path" || key === "ELECTRON_RUN_AS_NODE" || key === "ELECTRON_NO_ATTACH_CONSOLE") continue;
        env[key] = value;
    }
    env[isWindows ? "Path" : "PATH"] = resolvedPath;
    env.GIT_TERMINAL_PROMPT = "0";
    env.NO_UPDATE_NOTIFIER = "1";
    env.npm_config_update_notifier = "false";
    env.FORCE_COLOR = "0";
    return env;
}

export function which(command: string): string | null {
    const extensions = isWindows ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean) : [""];
    for (const dir of resolvedPath.split(delimiter)) {
        if (!dir) continue;
        for (const extension of extensions) {
            const candidate = join(dir, command + extension.toLowerCase());
            try {
                if (statSync(candidate).isFile()) return candidate;
            } catch {}
        }
    }
    return null;
}
