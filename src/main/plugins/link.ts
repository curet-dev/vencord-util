import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import type { PluginLinkResult, PluginSource, UserPlugin } from "@shared/types";
import { getConfig, paths, setConfig } from "../core/config";
import { UserError } from "../core/errors";
import { notifyChanged } from "../core/events";
import type { TaskContext } from "../core/tasks";
import { type FoundPlugin, findPluginCandidates, findPluginIndex } from "./detect";
import { hashTree, readText, tryRemovePath } from "./fsutil";
import { cloneRepository, readSnapshot, resolveTreePath } from "./git";
import { describePlugin, locatePlugin, savePluginSource } from "./library";
import { parsePluginMeta } from "./meta";
import { download } from "./remote";
import { CODE_FILE, type PluginLink, parsePluginUrl } from "./source";
import { fileRevision } from "./staging";

interface RemotePlugin {
    path: string;
    source: PluginSource;
}

const toPosix = (path: string) => path.split(sep).join("/");

function pluginName(found: FoundPlugin) {
    const file = found.kind === "file" ? found.path : findPluginIndex(found.path);
    return file ? parsePluginMeta(readText(file)).name : undefined;
}

/** Picks the plugin in the repository that corresponds to the installed plugin. */
export function matchCandidate(candidates: FoundPlugin[], plugin: Pick<UserPlugin, "id" | "kind" | "name">): FoundPlugin {
    const label = plugin.name ?? plugin.id;
    const sameKind = candidates.filter(candidate => candidate.kind === plugin.kind);
    if (!sameKind.length) {
        throw new UserError(
            candidates.length
                ? `The link contains a ${candidates[0].kind === "file" ? "single-file plugin" : "plugin folder"}, but “${label}” is a ${plugin.kind === "file" ? "single file" : "folder"}.`
                : "No Vencord plugin was found there."
        );
    }

    const byName = plugin.name ? sameKind.filter(candidate => pluginName(candidate) === plugin.name) : [];
    if (byName.length === 1) return byName[0];
    const byFolder = sameKind.filter(candidate => basename(candidate.path) === plugin.id);
    if (byFolder.length === 1) return byFolder[0];

    if (sameKind.length === 1) {
        const remoteName = pluginName(sameKind[0]);
        if (plugin.name && remoteName && remoteName !== plugin.name) {
            throw new UserError(
                `The plugin at this link is called “${remoteName}”, not “${plugin.name}”.`,
                "Check the link or install the plugin as a new one."
            );
        }
        return sameKind[0];
    }
    throw new UserError(
        `The repository contains ${sameKind.length} plugins and none of them clearly matches “${label}”.`,
        "Link the plugin's folder directly, e.g. https://github.com/user/repo/tree/main/plugins/myPlugin"
    );
}

async function fetchRepository(link: Extract<PluginLink, { kind: "repo" }>, plugin: UserPlugin, workDir: string, ctx: TaskContext): Promise<RemotePlugin> {
    let ref: string | undefined;
    let subdir = "";
    let isCommit = false;
    if (link.treePath?.length) {
        ctx.step("fetch", "running", "Resolving branch");
        ({ ref, subdir, isCommit } = await resolveTreePath(link.cloneUrl, link.treePath, ctx));
    }
    if (isCommit) throw new UserError("Links to a single commit cannot be tracked for updates.", "Link a branch instead, e.g. …/tree/main/myPlugin");

    ctx.step("fetch", "running", "Cloning repository");
    const repoDir = join(workDir, "repo");
    await cloneRepository(repoDir, link.cloneUrl, ref, false, ctx);
    const root = subdir ? join(repoDir, ...subdir.split("/")) : repoDir;
    if (!existsSync(root)) throw new UserError(`The path “${subdir}” does not exist in the repository.`);

    ctx.step("analyze");
    const match = matchCandidate(findPluginCandidates(root), plugin);
    const snapshot = await readSnapshot(repoDir);
    const path = toPosix(relative(repoDir, match.path));
    const base = {
        url: link.cloneUrl,
        ref: ref ?? (snapshot.ref || undefined),
        commit: snapshot.commit,
        installedAt: plugin.source?.installedAt ?? Date.now()
    };
    const source: PluginSource = path
        ? { ...base, type: "git-subdir", subdir: path, revision: snapshot.objects.get(path) }
        : { ...base, type: "git", revision: snapshot.commit };
    return { path: match.path, source };
}

async function fetchFile(link: Extract<PluginLink, { kind: "file" }>, plugin: UserPlugin, workDir: string, ctx: TaskContext): Promise<RemotePlugin> {
    if (plugin.kind === "folder") {
        if (countCodeFiles(plugin.path) > 1)
            throw new UserError("A single file cannot replace a plugin folder with several files.", "Link the repository or the plugin's folder instead.");
    }
    ctx.step("fetch", "running", "Downloading file");
    const data = await download(link.url);
    mkdirSync(workDir, { recursive: true });
    const path = join(workDir, link.fileName);
    writeFileSync(path, data);
    ctx.step("analyze");
    if (!parsePluginMeta(data.toString("utf8")).isPlugin) throw new UserError("The file does not contain a Vencord plugin (definePlugin).");
    return {
        path,
        source: { type: "url-file", url: link.url, revision: fileRevision(link.url, data), installedAt: plugin.source?.installedAt ?? Date.now() }
    };
}

function countCodeFiles(dir: string): number {
    let count = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        if (entry.isDirectory()) count += countCodeFiles(join(dir, entry.name));
        else if (CODE_FILE.test(entry.name) && !/\.d\.ts$/i.test(entry.name)) count++;
    }
    return count;
}

function sameContent(remote: RemotePlugin, plugin: UserPlugin) {
    if (remote.source.type !== "url-file") return hashTree(remote.path) === hashTree(plugin.path);
    const local = plugin.kind === "folder" ? findPluginIndex(plugin.path) : plugin.path;
    if (!local) return false;
    try {
        return readFileSync(local).equals(readFileSync(remote.path));
    } catch {
        return false;
    }
}

/**
 * Connects an installed plugin with the repository or file it came from, so the update check can track it.
 * The local files are not changed: if they differ from the remote version, the plugin is flagged as "update available".
 */
export async function linkPluginSource(id: string, input: string, ctx: TaskContext): Promise<PluginLinkResult> {
    const plugin = describePlugin(id, locatePlugin(id));
    if (!plugin) throw new UserError(`“${id}” is not a plugin.`);
    if (plugin.isGit) throw new UserError(`“${plugin.name ?? id}” is a Git clone and is already updated with git pull.`);

    ctx.step("fetch");
    const link = parsePluginUrl(input);
    if (link.kind === "zip") throw new UserError("ZIP downloads cannot be tracked for updates.", "Use the link of the repository instead.");

    const workDir = join(paths.staging, `link-${randomUUID()}`);
    try {
        const remote = link.kind === "repo" ? await fetchRepository(link, plugin, workDir, ctx) : await fetchFile(link, plugin, workDir, ctx);
        ctx.step("link");
        const upToDate = sameContent(remote, plugin);
        savePluginSource(id, upToDate ? remote.source : { ...remote.source, revision: undefined, commit: undefined });
        if (!upToDate) {
            const latest = remote.source.revision;
            setConfig({ pluginUpdates: { ...getConfig().pluginUpdates, [id]: { available: true, checkedAt: Date.now(), latest } } });
        }
        ctx.log(
            upToDate
                ? `${plugin.name ?? id}: linked – the local files match the repository.`
                : `${plugin.name ?? id}: linked – the repository has a different version.`,
            "success"
        );
        notifyChanged("plugins", "config");
        return { upToDate };
    } finally {
        tryRemovePath(workDir);
    }
}
