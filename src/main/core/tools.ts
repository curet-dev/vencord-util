import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EnvStatus, ToolInfo, ToolName } from "@shared/types";
import { shell } from "electron";
import { getConfig, paths } from "./config";
import { UserError } from "./errors";
import { tryExec } from "./exec";
import { refreshPath, which } from "./path";
import type { TaskContext } from "./tasks";

const DEFAULT_NODE_MAJOR = 22;
const MIN_PNPM_MAJOR = 9;

const VERSION_PATTERNS: Record<ToolName, RegExp> = {
    git: /git version (\S+)/i,
    node: /v?(\d+\.\d+\.\d+)/,
    pnpm: /(\d+\.\d+\.\d+\S*)/
};

const WINGET_PACKAGES = { git: "Git.Git", node: "OpenJS.NodeJS.LTS" } as const;
const DOWNLOAD_PAGES = { git: "https://git-scm.com/downloads", node: "https://nodejs.org/en/download" } as const;
const TOOL_LABELS: Record<ToolName, string> = { git: "Git", node: "Node.js", pnpm: "pnpm" };

export const toolLabel = (tool: ToolName) => TOOL_LABELS[tool];

function requiredNodeMajor() {
    try {
        const pkg = JSON.parse(readFileSync(join(getConfig().vencordDir, "package.json"), "utf8"));
        const major = String(pkg.engines?.node ?? "").match(/(\d+)/)?.[1];
        return major ? Number(major) : DEFAULT_NODE_MAJOR;
    } catch {
        return DEFAULT_NODE_MAJOR;
    }
}

async function inspectTool(name: ToolName, nodeMajor: number): Promise<ToolInfo> {
    const path = which(name);
    if (!path) return { name, found: false, ok: false, problem: "Not found" };

    const result = await tryExec(name, ["--version"]);
    const version = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`.match(VERSION_PATTERNS[name])?.[1];
    if (!result || !version) return { name, found: true, path, ok: false, problem: "Broken – fails to start" };

    const major = Number(version.split(".")[0]);
    if (name === "node" && major < nodeMajor) {
        return { name, found: true, path, version, ok: false, problem: `Node.js ${nodeMajor} or newer is required` };
    }
    if (name === "pnpm" && major < MIN_PNPM_MAJOR) {
        return { name, found: true, path, version, ok: false, problem: `pnpm ${MIN_PNPM_MAJOR} or newer is required` };
    }
    return { name, found: true, path, version, ok: true };
}

export async function getEnvStatus(): Promise<EnvStatus> {
    const nodeMajor = requiredNodeMajor();
    const [git, node, pnpm] = await Promise.all((["git", "node", "pnpm"] as const).map(tool => inspectTool(tool, nodeMajor)));
    const installer = process.platform === "win32" ? "winget" : process.platform === "darwin" ? "brew" : null;
    return {
        platform: process.platform,
        arch: process.arch,
        tools: { git, node, pnpm },
        installer: installer && which(installer) ? installer : null,
        requiredNodeMajor: nodeMajor
    };
}

export function requireTools(...tools: ToolName[]) {
    for (const tool of tools) {
        if (!which(tool)) {
            throw new UserError(`${toolLabel(tool)} was not found.`, "Install the missing requirements on the “Install” page.");
        }
    }
}

async function installPnpm(ctx: TaskContext) {
    if (!which("npm")) throw new UserError("npm was not found – please install Node.js first.");
    ctx.log("Installing pnpm locally for Vencord Util (no admin rights required) …");
    await ctx.exec("npm", ["install", "--prefix", paths.tools, "--no-audit", "--no-fund", "--loglevel=error", "pnpm@latest"]);
}

async function installOnWindows(tool: "git" | "node", ctx: TaskContext) {
    if (!which("winget")) {
        await shell.openExternal(DOWNLOAD_PAGES[tool]);
        throw new UserError("winget is not available – the download page was opened in your browser.");
    }
    ctx.log(`Installing ${tool === "git" ? "Git" : "Node.js LTS"} via winget. Confirm the Windows prompt (UAC) if it appears.`);
    await ctx.exec("winget", [
        "install",
        "--id",
        WINGET_PACKAGES[tool],
        "-e",
        "--source",
        "winget",
        "--accept-package-agreements",
        "--accept-source-agreements",
        "--disable-interactivity"
    ]);
}

async function installOnMac(tool: "git" | "node", ctx: TaskContext) {
    if (which("brew")) {
        await ctx.exec("brew", ["install", tool]);
        return;
    }
    if (tool === "git") {
        await tryExec("xcode-select", ["--install"]);
        throw new UserError("A macOS dialog to install the Command Line Tools (includes Git) has been opened. Check again afterwards.");
    }
    await shell.openExternal(DOWNLOAD_PAGES.node);
    throw new UserError("Homebrew is not installed – the Node.js download page has been opened. Check again afterwards.");
}

export async function installTool(tool: ToolName, ctx: TaskContext) {
    if (tool === "pnpm") await installPnpm(ctx);
    else if (process.platform === "win32") await installOnWindows(tool, ctx);
    else if (process.platform === "darwin") await installOnMac(tool, ctx);
    else throw new UserError("Automatic installation is not supported on this system.");
    await refreshPath();
}
