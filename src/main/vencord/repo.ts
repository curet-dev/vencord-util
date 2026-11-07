import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { UpdateCommit, UpdateInfo, VencordStatus } from "@shared/types";
import { getConfig, setConfig } from "../core/config";
import { UserError } from "../core/errors";
import { notifyChanged } from "../core/events";
import { gitOutput, tryExec } from "../core/exec";
import { which } from "../core/path";
import { isBusy, type TaskContext } from "../core/tasks";
import { requireTools } from "../core/tools";

const PNPM_ENV = { CI: "true", npm_config_yes: "true" };
const FIELD_SEPARATOR = "\x1f";
const MAX_LISTED_COMMITS = "60";

export const vencordDir = () => getConfig().vencordDir;
export const userPluginsDir = () => join(vencordDir(), "src", "userplugins");

function readPackageJson(dir: string): { name?: string; version?: string } | null {
    try {
        return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {
        return null;
    }
}

export function isVencordRepo(dir: string) {
    return existsSync(join(dir, ".git")) && existsSync(join(dir, "scripts", "build")) && readPackageJson(dir)?.name === "vencord";
}

function assertRepo() {
    if (!isVencordRepo(vencordDir())) throw new UserError("Vencord has not been downloaded yet.");
    return vencordDir();
}

async function readGitInfo(dir: string) {
    const [commit, latest, branch, remote, dirty] = await Promise.all([
        gitOutput(["rev-parse", "--short", "HEAD"], dir),
        gitOutput(["log", "-1", `--format=%s${FIELD_SEPARATOR}%cI`], dir),
        gitOutput(["rev-parse", "--abbrev-ref", "HEAD"], dir),
        gitOutput(["remote", "get-url", "origin"], dir),
        gitOutput(["status", "--porcelain", "--untracked-files=no"], dir)
    ]);
    const [commitMessage, commitDate] = latest?.split(FIELD_SEPARATOR) ?? [];
    return { commit, commitMessage, commitDate, branch, remote, dirty: Boolean(dirty) };
}

export async function getVencordStatus(): Promise<VencordStatus> {
    const dir = vencordDir();
    const exists = existsSync(dir);
    const isRepo = exists && existsSync(join(dir, ".git"));
    const pkg = exists ? readPackageJson(dir) : null;
    const patcher = join(dir, "dist", "patcher.js");
    const built = existsSync(patcher);

    const status: VencordStatus = {
        dir,
        exists,
        isRepo,
        isVencord: isRepo && pkg?.name === "vencord",
        version: pkg?.version,
        dirty: false,
        depsInstalled: existsSync(join(dir, "node_modules", ".modules.yaml")) || existsSync(join(dir, "node_modules", ".pnpm")),
        built,
        builtAt: built ? statSync(patcher).mtimeMs : undefined,
        userPluginsDir: userPluginsDir()
    };
    return isRepo && which("git") ? { ...status, ...(await readGitInfo(dir)) } : status;
}

export async function cloneVencord(ctx: TaskContext) {
    requireTools("git");
    const { vencordDir: dir, repoUrl, repoBranch } = getConfig();

    if (existsSync(dir)) {
        if (isVencordRepo(dir)) {
            ctx.log(`Using existing Vencord clone in ${dir}.`);
            return false;
        }
        if (readdirSync(dir).length > 0) {
            throw new UserError(`The folder “${dir}” already exists and is not a Vencord repository.`, "Choose an empty or new folder in Settings.");
        }
    }

    mkdirSync(dirname(dir), { recursive: true });
    const branchArgs = repoBranch.trim() ? ["--branch", repoBranch.trim()] : [];
    await ctx.exec("git", ["clone", "--progress", "--filter=blob:none", ...branchArgs, repoUrl, dir], { collapseProgress: true });
    notifyChanged("vencord");
    return true;
}

export async function installDependencies(ctx: TaskContext) {
    requireTools("node", "pnpm");
    await ctx.exec("pnpm", ["install", "--frozen-lockfile"], { cwd: assertRepo(), env: PNPM_ENV, collapseProgress: true });
}

export async function buildVencord(ctx: TaskContext) {
    requireTools("node", "pnpm");
    const dir = assertRepo();
    if (!existsSync(join(dir, "node_modules"))) await installDependencies(ctx);

    await ctx.exec("pnpm", getConfig().devBuild ? ["build", "--dev"] : ["build"], { cwd: dir, env: PNPM_ENV });
    if (!existsSync(join(dir, "dist", "patcher.js"))) {
        throw new UserError("The build finished, but dist/patcher.js is missing.", "Check the output in the console.");
    }
    setConfig({ needsRebuild: false });
    notifyChanged("vencord", "config");
}

function parseCommits(output: string): UpdateCommit[] {
    return output
        .split("\n")
        .filter(Boolean)
        .map(line => {
            const [hash, author, date, message] = line.split(FIELD_SEPARATOR);
            return { hash, author, date, message };
        });
}

export async function checkVencordUpdates(): Promise<UpdateInfo> {
    const base: UpdateInfo = { behind: 0, ahead: 0, commits: [], checkedAt: Date.now() };
    const dir = vencordDir();
    if (!isVencordRepo(dir) || !which("git")) return { ...base, error: "Vencord is not installed." };
    if (isBusy()) return getConfig().lastUpdate ?? base;

    let info: UpdateInfo;
    if (!(await tryExec("git", ["fetch", "--quiet", "origin"], { cwd: dir, timeoutMs: 90_000 }))) {
        info = { ...base, error: "git fetch failed – no connection to GitHub?" };
    } else if (!(await gitOutput(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], dir))) {
        info = { ...base, error: "The current branch has no upstream." };
    } else {
        const counts = (await gitOutput(["rev-list", "--left-right", "--count", "HEAD...@{u}"], dir)) ?? "0 0";
        const [ahead, behind] = counts.split(/\s+/).map(Number);
        const log = await gitOutput(
            ["log", `--format=%h${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%s`, "-n", MAX_LISTED_COMMITS, "HEAD..@{u}"],
            dir
        );
        info = { ...base, ahead: ahead || 0, behind: behind || 0, commits: parseCommits(log ?? "") };
    }
    setConfig({ lastUpdate: info });
    notifyChanged("config");
    return info;
}

export async function pullVencord(ctx: TaskContext, stash: boolean) {
    requireTools("git");
    const dir = assertRepo();

    if (stash && (await gitOutput(["status", "--porcelain", "--untracked-files=no"], dir))) {
        ctx.log("Stashing local changes with git stash …");
        await ctx.exec("git", ["stash", "push", "-m", `vencord-util ${new Date().toISOString()}`], { cwd: dir });
        ctx.log("Restore them later with: git stash pop", "warn");
    }

    const before = await gitOutput(["rev-parse", "HEAD"], dir);
    await ctx.exec("git", ["pull", "--ff-only"], { cwd: dir });
    const after = await gitOutput(["rev-parse", "HEAD"], dir);
    setConfig({ lastUpdate: { behind: 0, ahead: 0, commits: [], checkedAt: Date.now() } });
    return before !== after;
}
