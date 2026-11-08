import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import type { PluginSource, StagedCandidate, StageResult } from "@shared/types";
import { paths, setConfig } from "../core/config";
import { UserError } from "../core/errors";
import { notifyChanged } from "../core/events";
import type { TaskContext } from "../core/tasks";
import { userPluginsDir } from "../vencord/repo";
import { findPluginCandidates, findPluginIndex } from "./detect";
import { copyPlugin, extractZip, gitBlobSha, isDir, movePath, readText, removePath, sha256, tryRemovePath } from "./fsutil";
import { cloneRepository, type RepoSnapshot, readSnapshot, resolveTreePath } from "./git";
import { DISABLED_DIR, pluginExists, pluginPath, savePluginSource } from "./library";
import { parsePluginMeta } from "./meta";
import { download } from "./remote";
import { CODE_FILE, isIndexFile, type PluginLink, parseGithubRawUrl, parsePluginUrl, sanitizeName } from "./source";

interface Candidate extends StagedCandidate {
    absolutePath: string;
    moveRepository: boolean;
    source: PluginSource;
}

interface Staging {
    id: string;
    dir: string;
    label: string;
    candidates: Candidate[];
}

interface RepoContext {
    dir: string;
    snapshot: RepoSnapshot;
}

const stagings = new Map<string, Staging>();

const toPosix = (path: string) => path.split(sep).join("/");

export function cleanStaging() {
    tryRemovePath(paths.staging);
}

export function discardStaging(id: string) {
    const staging = stagings.get(id);
    if (!staging) return;
    stagings.delete(id);
    tryRemovePath(staging.dir);
}

function createStaging(label: string): Staging {
    const id = randomUUID();
    const dir = join(paths.staging, id);
    mkdirSync(dir, { recursive: true });
    const staging: Staging = { id, dir, label, candidates: [] };
    stagings.set(id, staging);
    return staging;
}

export const fileRevision = (url: string, data: Uint8Array) => (parseGithubRawUrl(url) ? gitBlobSha(data) : `sha256:${sha256(data)}`);

function sourceFor(base: PluginSource, candidatePath: string, repo?: RepoContext): PluginSource {
    if (!repo) return base;
    const subdir = toPosix(relative(repo.dir, candidatePath));
    if (!subdir) return { ...base, type: "git", subdir: undefined, revision: repo.snapshot.commit, commit: repo.snapshot.commit };
    return { ...base, type: "git-subdir", subdir, revision: repo.snapshot.objects.get(subdir), commit: repo.snapshot.commit };
}

/** Folder names that say nothing about the plugin, e.g. a plugin living in "src" of its repository. */
const GENERIC_FOLDER_NAMES = new Set(["src", "source", "plugin", "plugins", "dist", "lib", "index", "repo", "main", "master"]);

/** "Cool Plugin" → "coolPlugin", the naming style of Vencord plugin folders. */
export function folderNameFor(pluginName: string | undefined) {
    const words = pluginName?.split(/[^A-Za-z0-9]+/).filter(Boolean) ?? [];
    return words.map((word, index) => (index ? word[0].toUpperCase() : word[0].toLowerCase()) + word.slice(1)).join("");
}

export function pluginFolderName(folder: string, pluginName: string | undefined, fallback: string) {
    if (!GENERIC_FOLDER_NAMES.has(folder.toLowerCase())) return sanitizeName(folder);
    return sanitizeName(folderNameFor(pluginName) || fallback);
}

function addCandidates(staging: Staging, root: string, rootName: string, base: PluginSource, repo?: RepoContext, fallbackName = rootName) {
    for (const found of findPluginCandidates(root)) {
        const isRoot = resolve(found.path) === resolve(root);
        const extension = extname(found.path).toLowerCase();
        const metaFile = found.kind === "file" ? found.path : findPluginIndex(found.path);
        const meta = parsePluginMeta(metaFile ? readText(metaFile) : "");
        const targetName =
            found.kind === "file"
                ? sanitizeName(basename(found.path, extname(found.path))) + extension
                : pluginFolderName(
                      isRoot ? rootName : basename(found.path),
                      meta.name,
                      isRoot || resolve(dirname(found.path)) === resolve(root) ? fallbackName : basename(dirname(found.path))
                  );

        staging.candidates.push({
            id: String(staging.candidates.length),
            kind: found.kind,
            relPath: toPosix(relative(repo?.dir ?? root, found.path)) || ".",
            targetName,
            name: meta.name,
            description: meta.description,
            exists: pluginExists(targetName),
            absolutePath: found.path,
            moveRepository: Boolean(repo) && resolve(found.path) === resolve(repo?.dir ?? "") && existsSync(join(found.path, ".git")),
            source: sourceFor(base, found.path, repo)
        });
    }
}

function toResult(staging: Staging): StageResult {
    if (!staging.candidates.length) {
        discardStaging(staging.id);
        throw new UserError(
            "No Vencord plugin was found there.",
            "A plugin is a folder with index.ts/index.tsx or a single .ts/.tsx file that calls definePlugin()."
        );
    }
    return {
        stagingId: staging.id,
        label: staging.label,
        candidates: staging.candidates.map(({ id, kind, relPath, targetName, name, description, exists }) => ({
            id,
            kind,
            relPath,
            targetName,
            name,
            description,
            exists
        }))
    };
}

async function stageRepository(staging: Staging, link: Extract<PluginLink, { kind: "repo" }>, ctx: TaskContext) {
    let ref: string | undefined;
    let subdir = "";
    let isCommit = false;
    if (link.treePath?.length) {
        ctx.step("fetch", "running", "Resolving branch");
        ({ ref, subdir, isCommit } = await resolveTreePath(link.cloneUrl, link.treePath, ctx));
    }

    ctx.step("fetch", "running", "Cloning repository");
    const repoDir = join(staging.dir, "repo");
    await cloneRepository(repoDir, link.cloneUrl, ref, isCommit, ctx);
    const root = subdir ? join(repoDir, ...subdir.split("/")) : repoDir;
    if (!existsSync(root)) throw new UserError(`The path “${subdir}” does not exist in the repository.`);

    ctx.step("analyze");
    const snapshot = await readSnapshot(repoDir);
    const base: PluginSource = { type: "git", url: link.cloneUrl, ref: ref ?? (snapshot.ref || undefined), installedAt: Date.now() };
    addCandidates(staging, root, subdir ? basename(root) : link.name, base, { dir: repoDir, snapshot }, link.name);
}

async function stageFile(staging: Staging, link: Extract<PluginLink, { kind: "file" }>, ctx: TaskContext) {
    ctx.step("fetch", "running", "Downloading file");
    const data = await download(link.url);
    const extension = extname(link.fileName).toLowerCase();
    const wrapInFolder = isIndexFile(link.fileName);
    const target = wrapInFolder
        ? join(staging.dir, sanitizeName(link.parentName), link.fileName)
        : join(staging.dir, sanitizeName(basename(link.fileName, extname(link.fileName))) + extension);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);

    ctx.step("analyze");
    const base: PluginSource = { type: "url-file", url: link.url, revision: fileRevision(link.url, data), installedAt: Date.now() };
    addCandidates(staging, wrapInFolder ? dirname(target) : target, sanitizeName(link.parentName), base);
}

async function stageZip(staging: Staging, link: Extract<PluginLink, { kind: "zip" }>, ctx: TaskContext) {
    ctx.step("fetch", "running", "Downloading ZIP");
    const data = await download(link.url);
    ctx.step("analyze");
    const root = extractZip(data, join(staging.dir, "zip"));
    addCandidates(staging, root, link.name.replace(/-(main|master)$/i, ""), { type: "local", localPath: link.url, installedAt: Date.now() });
}

export async function stageFromUrl(input: string, ctx: TaskContext): Promise<StageResult> {
    const link = parsePluginUrl(input);
    const staging = createStaging(link.webUrl);
    try {
        if (link.kind === "repo") await stageRepository(staging, link, ctx);
        else if (link.kind === "file") await stageFile(staging, link, ctx);
        else await stageZip(staging, link, ctx);
        return toResult(staging);
    } catch (error) {
        discardStaging(staging.id);
        throw error;
    }
}

function stageLocalPath(staging: Staging, path: string, ctx: TaskContext) {
    const source: PluginSource = { type: "local", localPath: path, installedAt: Date.now() };
    if (isDir(path)) {
        addCandidates(staging, path, sanitizeName(basename(path)), source);
    } else if (/\.zip$/i.test(path)) {
        const root = extractZip(readFileSync(path), join(staging.dir, `zip-${staging.candidates.length}`));
        addCandidates(staging, root, sanitizeName(basename(path, ".zip").replace(/-(main|master)$/i, "")), source);
    } else if (CODE_FILE.test(path)) {
        const indexFile = isIndexFile(basename(path));
        addCandidates(staging, indexFile ? dirname(path) : path, sanitizeName(basename(indexFile ? dirname(path) : path, extname(path))), source);
    } else {
        ctx.log(`Skipped (not a folder, .zip or .ts/.tsx): ${path}`, "warn");
    }
}

export async function stageFromPaths(inputPaths: string[], ctx: TaskContext): Promise<StageResult> {
    if (!inputPaths.length) throw new UserError("No files selected.");
    const staging = createStaging(inputPaths.length === 1 ? basename(inputPaths[0]) : `${inputPaths.length} items`);
    try {
        for (const path of inputPaths) {
            ctx.step("analyze", "running", basename(path));
            stageLocalPath(staging, path, ctx);
        }
        return toResult(staging);
    } catch (error) {
        discardStaging(staging.id);
        throw error;
    }
}

export function commitStaging(stagingId: string, ids: string[]): string[] {
    const staging = stagings.get(stagingId);
    if (!staging) throw new UserError("This selection has expired. Please add the plugin again.");
    if (!existsSync(dirname(userPluginsDir()))) throw new UserError("Vencord is not installed yet.", "Install Vencord from source first.");

    const chosen = staging.candidates.filter(candidate => ids.includes(candidate.id));
    const names = new Set<string>();
    for (const candidate of chosen) {
        if (names.has(candidate.targetName)) throw new UserError(`Two selected plugins are both named “${candidate.targetName}”.`);
        names.add(candidate.targetName);
    }

    mkdirSync(userPluginsDir(), { recursive: true });
    for (const candidate of chosen) {
        const destination = pluginPath(candidate.targetName, true);
        removePath(destination);
        removePath(join(userPluginsDir(), DISABLED_DIR, candidate.targetName));
        if (candidate.moveRepository) movePath(candidate.absolutePath, destination);
        else copyPlugin(candidate.absolutePath, destination);
        savePluginSource(candidate.targetName, { ...candidate.source, installedAt: Date.now() });
    }

    if (chosen.length) setConfig({ needsRebuild: true });
    discardStaging(stagingId);
    notifyChanged("plugins", "config");
    return chosen.map(candidate => candidate.targetName);
}
