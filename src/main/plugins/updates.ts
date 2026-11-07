import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { PluginSource, PluginUpdateStatus, UserPlugin } from "@shared/types";
import { paths, setConfig } from "../core/config";
import { UserError } from "../core/errors";
import { notifyChanged } from "../core/events";
import { gitOutput } from "../core/exec";
import type { TaskContext } from "../core/tasks";
import { findPluginIndex } from "./detect";
import { copyPlugin, hashTree, removePath, tryRemovePath } from "./fsutil";
import { cloneRepository, readSnapshot, remoteHead } from "./git";
import { describePlugin, listPlugins, locatePlugin, savePluginSource } from "./library";
import { download, fetchGithubTree } from "./remote";
import { type GithubRepo, parseGithubRawUrl, parseGithubRepo } from "./source";
import { fileRevision } from "./staging";

type CheckResult = Omit<PluginUpdateStatus, "checkedAt">;

interface UpdateResult {
    changed: boolean;
    source?: PluginSource;
}

const UNREACHABLE = "Could not reach the remote repository.";

class GithubTreeCache {
    private readonly trees = new Map<string, Promise<Map<string, string>>>();

    get(repo: GithubRepo, ref: string) {
        const key = `${repo.owner}/${repo.repo}@${ref}`;
        let tree = this.trees.get(key);
        if (!tree) {
            tree = fetchGithubTree(repo, ref);
            this.trees.set(key, tree);
        }
        return tree;
    }
}

function githubLocation(source: PluginSource) {
    if (source.type === "url-file") {
        const raw = parseGithubRawUrl(source.url);
        return raw ? { repo: raw, ref: raw.ref, path: raw.path } : null;
    }
    const repo = parseGithubRepo(source.url);
    return repo && source.type === "git-subdir" && source.subdir ? { repo, ref: source.ref ?? "HEAD", path: source.subdir } : null;
}

async function checkGitClone(plugin: UserPlugin): Promise<CheckResult> {
    const [head, branch] = await Promise.all([gitOutput(["rev-parse", "HEAD"], plugin.path), gitOutput(["rev-parse", "--abbrev-ref", "HEAD"], plugin.path)]);
    if (!head || !branch || branch === "HEAD") return { available: false, error: "Not on a branch – cannot check for updates." };
    const latest = await remoteHead("origin", branch, plugin.path);
    return latest ? { available: latest !== head, latest } : { available: false, error: UNREACHABLE };
}

async function checkSource(source: PluginSource, trees: GithubTreeCache): Promise<CheckResult> {
    const github = githubLocation(source);
    if (github) {
        const latest = (await trees.get(github.repo, github.ref)).get(github.path);
        if (!latest) return { available: false, error: "No longer exists in the repository." };
        return source.revision ? { available: latest !== source.revision, latest } : { available: false, untracked: true, latest };
    }
    if (source.type === "url-file" && source.url) {
        const latest = fileRevision(source.url, await download(source.url));
        return { available: latest !== source.revision, latest };
    }
    if (!source.url) return { available: false };
    const latest = await remoteHead(source.url, source.ref, paths.userData);
    if (!latest) return { available: false, error: UNREACHABLE };
    return source.commit ? { available: latest !== source.commit, latest } : { available: false, untracked: true, latest };
}

export async function checkPluginUpdates(): Promise<number> {
    const trees = new GithubTreeCache();
    const checkedAt = Date.now();
    const plugins = listPlugins().filter(plugin => plugin.updatable);

    const entries = await Promise.all(
        plugins.map(async (plugin): Promise<[string, PluginUpdateStatus]> => {
            try {
                const result = plugin.isGit || !plugin.source ? await checkGitClone(plugin) : await checkSource(plugin.source, trees);
                return [plugin.id, { ...result, checkedAt }];
            } catch (error) {
                return [plugin.id, { available: false, checkedAt, error: (error as Error).message }];
            }
        })
    );

    setConfig({ pluginUpdates: Object.fromEntries(entries), lastPluginCheck: checkedAt });
    notifyChanged("plugins", "config");
    return entries.filter(([, status]) => status.available).length;
}

async function updateGitClone(plugin: UserPlugin, ctx: TaskContext): Promise<UpdateResult> {
    const before = await gitOutput(["rev-parse", "HEAD"], plugin.path);
    await ctx.exec("git", ["pull", "--ff-only"], { cwd: plugin.path });
    const after = await gitOutput(["rev-parse", "HEAD"], plugin.path);
    return { changed: before !== after, source: plugin.source && { ...plugin.source, revision: after, commit: after } };
}

async function fetchLatest(plugin: UserPlugin, source: PluginSource, workDir: string, ctx: TaskContext) {
    if (!source.url) throw new UserError(`“${plugin.name ?? plugin.id}” has no remote source.`);

    if (source.type === "url-file") {
        const data = await download(source.url);
        const fileName = plugin.kind === "folder" ? basename(findPluginIndex(plugin.path) ?? "index.tsx") : basename(plugin.path);
        const file = plugin.kind === "folder" ? join(workDir, "plugin", fileName) : join(workDir, fileName);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, data);
        return { path: plugin.kind === "folder" ? dirname(file) : file, source: { ...source, revision: fileRevision(source.url, data) } };
    }

    const repoDir = join(workDir, "repo");
    await cloneRepository(repoDir, source.url, source.ref, false, ctx);
    const snapshot = await readSnapshot(repoDir);
    const path = source.subdir ? join(repoDir, ...source.subdir.split("/")) : repoDir;
    if (!existsSync(path)) throw new UserError(`“${source.subdir}” no longer exists in the repository.`);
    return {
        path,
        source: {
            ...source,
            ref: source.ref ?? (snapshot.ref || undefined),
            revision: source.subdir ? snapshot.objects.get(source.subdir) : snapshot.commit,
            commit: snapshot.commit
        }
    };
}

async function updateFromSource(plugin: UserPlugin, source: PluginSource, ctx: TaskContext): Promise<UpdateResult> {
    const workDir = join(paths.staging, `update-${randomUUID()}`);
    try {
        const latest = await fetchLatest(plugin, source, workDir, ctx);
        const changed = hashTree(latest.path) !== hashTree(plugin.path);
        if (changed) {
            removePath(plugin.path);
            copyPlugin(latest.path, plugin.path);
        }
        return { changed, source: latest.source };
    } finally {
        tryRemovePath(workDir);
    }
}

export async function updatePlugin(id: string, ctx: TaskContext): Promise<boolean> {
    const plugin = describePlugin(id, locatePlugin(id));
    const label = plugin?.name ?? id;
    if (!plugin?.updatable) throw new UserError(`“${label}” was installed from a local source and cannot be updated automatically.`);

    const { changed, source } = plugin.isGit || !plugin.source ? await updateGitClone(plugin, ctx) : await updateFromSource(plugin, plugin.source, ctx);
    savePluginSource(id, source && (changed ? { ...source, updatedAt: Date.now() } : source));
    if (changed) setConfig({ needsRebuild: true });
    ctx.log(changed ? `${label}: updated` : `${label}: already up to date`, changed ? "success" : "info");
    notifyChanged("plugins", "config");
    return changed;
}

export function pluginsToUpdate() {
    const updatable = listPlugins().filter(plugin => plugin.updatable);
    const checked = updatable.some(plugin => plugin.update);
    return checked ? updatable.filter(plugin => plugin.update?.available || plugin.update?.untracked) : updatable;
}
