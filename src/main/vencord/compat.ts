import { readdirSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import type { CompatIssue, PluginCompat } from "@shared/types";
import spawn from "cross-spawn";
import { tryExec } from "../core/exec";
import { getSpawnEnv } from "../core/path";
import { isDir, readText } from "../plugins/fsutil";

/** Plugins whose imports from Vencord are checked. */
export interface CompatPlugin {
    id: string;
    name?: string;
    path: string;
}

interface PluginImport {
    file: string;
    line: number;
    module: string;
    names: string[];
}

export interface ScannedExports {
    values: Set<string>;
    types: Set<string>;
    stars: string[];
}

interface ExportSet {
    values: Set<string>;
    types: Set<string>;
    /** False if a re-export could not be followed, so the sets may be incomplete. */
    complete: boolean;
}

interface ParsedModule {
    values: Set<string>;
    types: Set<string>;
    stars: string[];
    complete: boolean;
}

const CODE_FILE = /\.(tsx?|jsx?|mts|cts)$/i;
const MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];
const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist"]);
const MAX_PLUGIN_FILES = 400;
const MAX_ISSUES_PER_PLUGIN = 25;
const MAX_EXPORT_DEPTH = 12;
const MAX_BATCH_BYTES = 32 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const ALIASES: Record<string, string> = {
    "@webpack": "src/webpack/webpack",
    "@webpack/common": "src/webpack/common",
    "@webpack/patcher": "src/webpack/patchWebpack",
    "@webpack/types": "src/webpack/types"
};

/** Maps a Vencord path alias (see Vencord's tsconfig.json) to a path inside the repository. */
export function aliasTarget(specifier: string): string | null {
    if (ALIASES[specifier]) return ALIASES[specifier];
    const common = specifier.match(/^@webpack\/common\/(.+)$/);
    if (common) return `src/webpack/common/${common[1]}`;
    const match = specifier.match(/^@(api|components|debug|main|plugins|shared|utils)\/(.+)$/);
    return match ? `src/${match[1]}/${match[2]}` : null;
}

const lineAt = (source: string, index: number) => source.slice(0, index).split("\n").length;

function bindingNames(list: string) {
    return list
        .split(",")
        .map(item => {
            const withoutDefault = item
                .split("=")[0]
                .trim()
                .replace(/^\.\.\./, "");
            const renamed = withoutDefault.includes(":") ? withoutDefault.split(":").pop() : withoutDefault;
            return renamed?.trim() ?? "";
        })
        .filter(name => IDENTIFIER.test(name));
}

/** Finds the names a TypeScript module exports. Only statements at the start of a line are considered. */
export function scanExports(source: string): ScannedExports {
    const values = new Set<string>();
    const types = new Set<string>();
    const stars: string[] = [];

    const declaration =
        /^[ \t]*export[ \t]+(?:declare[ \t]+)?(default[ \t]+)?(?:async[ \t]+)?(?:abstract[ \t]+)?(function\*?|class|const[ \t]+enum|const|let|var|enum|interface|type|namespace)[ \t]*\*?[ \t]*([A-Za-z_$][\w$]*)/gm;
    for (const match of source.matchAll(declaration)) {
        if (match[1]) values.add("default");
        (match[2] === "interface" || match[2] === "type" ? types : values).add(match[3]);
    }

    for (const match of source.matchAll(/^[ \t]*export[ \t]+(?:const|let|var)[ \t]+[{[]([^}\]]*)[}\]]/gm)) {
        for (const name of bindingNames(match[1])) values.add(name);
    }

    for (const match of source.matchAll(/^[ \t]*export[ \t]+(type[ \t]+)?\{([^}]*)\}/gm)) {
        for (const raw of match[2].split(",")) {
            const item = raw.trim();
            if (!item) continue;
            const typeOnly = Boolean(match[1]) || /^type[ \t]+/.test(item);
            const name = item
                .replace(/^type[ \t]+/, "")
                .split(/[ \t]+as[ \t]+/)
                .pop()
                ?.trim();
            if (name && (IDENTIFIER.test(name) || name === "default")) (typeOnly ? types : values).add(name);
        }
    }

    for (const match of source.matchAll(/^[ \t]*export[ \t]+(type[ \t]+)?\*[ \t]+as[ \t]+([A-Za-z_$][\w$]*)/gm)) (match[1] ? types : values).add(match[2]);
    for (const match of source.matchAll(/^[ \t]*export[ \t]+\*[ \t]+from[ \t]*["']([^"']+)["']/gm)) stars.push(match[1]);
    if (/^[ \t]*export[ \t]+default\b/m.test(source)) values.add("default");

    return { values, types, stars };
}

/** Finds value imports from Vencord path aliases. Type-only imports are skipped because they never break the build. */
export function scanImports(source: string, file: string): PluginImport[] {
    const imports: PluginImport[] = [];
    for (const match of source.matchAll(/^[ \t]*import[ \t]+(type[ \t]+)?([^'";]*?)[ \t]*from[ \t]*["']([^"']+)["']/gm)) {
        const [, typeOnly, clause, module] = match;
        if (typeOnly || !aliasTarget(module)) continue;

        const names: string[] = [];
        const braces = clause.match(/\{([\s\S]*)\}/);
        for (const raw of braces?.[1].split(",") ?? []) {
            const item = raw.trim();
            if (!item || /^type[ \t\n]/.test(item)) continue;
            const imported = item.split(/\s+as\s+/)[0].trim();
            if (IDENTIFIER.test(imported) || imported === "default") names.push(imported);
        }
        const head = clause
            .replace(/\{[\s\S]*\}/, "")
            .replace(/\*\s*as\s+[\w$]+/, "")
            .replace(/,/g, " ")
            .trim();
        if (IDENTIFIER.test(head)) names.push("default");

        imports.push({ file, line: lineAt(source, match.index ?? 0), module, names });
    }
    return imports;
}

function listCodeFiles(root: string) {
    if (!isDir(root)) return CODE_FILE.test(root) ? [root] : [];
    const files: string[] = [];
    const walk = (dir: string) => {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        for (const entry of entries) {
            if (files.length >= MAX_PLUGIN_FILES) return;
            if (SKIPPED_DIRS.has(entry) || entry.startsWith(".")) continue;
            const path = join(dir, entry);
            if (isDir(path)) walk(path);
            else if (CODE_FILE.test(entry) && !/\.d\.ts$/i.test(entry)) files.push(path);
        }
    };
    walk(root);
    return files;
}

function collectImports(plugin: CompatPlugin) {
    const imports: PluginImport[] = [];
    const folder = isDir(plugin.path);
    for (const file of listCodeFiles(plugin.path)) {
        const name = folder ? relative(plugin.path, file).split(sep).join("/") : plugin.id;
        imports.push(...scanImports(readText(file), name));
    }
    return imports;
}

/** Reads several files of one Git revision with a single `git cat-file --batch` call. */
function readBlobs(cwd: string, ref: string, paths: string[]): Promise<Map<string, string>> {
    return new Promise(resolve => {
        const result = new Map<string, string>();
        const chunks: Buffer[] = [];
        let size = 0;
        const child = spawn("git", ["cat-file", "--batch"], { cwd, env: getSpawnEnv(), windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
        const timer = setTimeout(() => child.kill(), GIT_TIMEOUT_MS);

        child.stdout?.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BATCH_BYTES) child.kill();
            else chunks.push(chunk);
        });
        child.on("error", () => {
            clearTimeout(timer);
            resolve(result);
        });
        child.on("close", () => {
            clearTimeout(timer);
            const buffer = Buffer.concat(chunks);
            let offset = 0;
            for (const path of paths) {
                const newline = buffer.indexOf(10, offset);
                if (newline < 0) break;
                const header = buffer.toString("utf8", offset, newline).match(/^[0-9a-f]+ (\w+) (\d+)$/);
                offset = newline + 1;
                if (!header) continue;
                const length = Number(header[2]);
                if (header[1] === "blob") result.set(path, buffer.toString("utf8", offset, offset + length));
                offset += length + 1;
            }
            resolve(result);
        });
        child.stdin?.on("error", () => undefined);
        child.stdin?.end(paths.map(path => `${ref}:${path}\n`).join(""));
    });
}

/** The Vencord source code at one Git revision. */
class SourceTree {
    private readonly parsed = new Map<string, ParsedModule | null>();

    private constructor(
        private readonly cwd: string,
        private readonly ref: string,
        private readonly files: Set<string>
    ) {}

    static async load(cwd: string, ref: string) {
        const result = await tryExec("git", ["ls-tree", "-r", "--name-only", "-z", ref, "--", "src"], { cwd, timeoutMs: GIT_TIMEOUT_MS });
        return result ? new SourceTree(cwd, ref, new Set(result.stdout.split("\0").filter(Boolean))) : null;
    }

    resolveBase(base: string) {
        const candidates = [base, ...MODULE_EXTENSIONS.map(extension => base + extension)];
        // TypeScript allows importing "./file.js" when the file on disk is "./file.ts".
        const jsExtension = base.match(/\.[cm]?jsx?$/)?.[0];
        if (jsExtension) candidates.push(...[".ts", ".tsx"].map(extension => base.slice(0, -jsExtension.length) + extension));
        return candidates.find(path => this.files.has(path)) ?? null;
    }

    resolveSpecifier(specifier: string, from: string) {
        if (specifier.startsWith(".")) return this.resolveBase(posix.normalize(posix.join(posix.dirname(from), specifier)));
        const target = aliasTarget(specifier);
        return target ? this.resolveBase(target) : null;
    }

    /** Parses the given modules and everything they re-export with `export *`. */
    async parse(entries: string[]) {
        let frontier = [...new Set(entries)].filter(file => CODE_FILE.test(file) && !this.parsed.has(file));
        for (let depth = 0; frontier.length && depth < MAX_EXPORT_DEPTH; depth++) {
            const sources = await readBlobs(this.cwd, this.ref, frontier);
            const next = new Set<string>();
            for (const file of frontier) {
                const source = sources.get(file);
                if (source === undefined) {
                    this.parsed.set(file, null);
                    continue;
                }
                const scanned = scanExports(source);
                const resolved = scanned.stars.map(specifier => this.resolveSpecifier(specifier, file));
                const stars = resolved.filter((path): path is string => Boolean(path));
                this.parsed.set(file, { ...scanned, stars, complete: stars.length === resolved.length && !/^[ \t]*export[ \t]*=/m.test(source) });
                for (const star of stars) if (CODE_FILE.test(star) && !this.parsed.has(star)) next.add(star);
            }
            frontier = [...next];
        }
    }

    /** Every name a module exports, including re-exports. `null` if the module could not be read. */
    exportsOf(file: string, seen = new Set<string>()): ExportSet | null {
        const module = this.parsed.get(file);
        if (!module) return null;
        const values = new Set(module.values);
        const types = new Set(module.types);
        let complete = module.complete;
        seen.add(file);
        for (const star of module.stars) {
            if (seen.has(star)) continue;
            const nested = this.exportsOf(star, seen);
            if (!nested?.complete) complete = false;
            for (const name of nested?.values ?? []) if (name !== "default") values.add(name);
            for (const name of nested?.types ?? []) types.add(name);
        }
        return { values, types, complete };
    }
}

/**
 * Reports plugin imports from Vencord that do not exist in `targetRef`.
 *
 * With `baseRef` (update check) only names that exist in `baseRef` but are gone in `targetRef` are reported, so unusual export
 * syntax can never cause a false alarm. Without it, every name the target does not export is reported – modules whose
 * exports cannot be determined completely are skipped.
 */
export async function analyzeCompat(repoDir: string, plugins: CompatPlugin[], targetRef: string, baseRef?: string): Promise<PluginCompat[]> {
    const pluginImports = plugins.map(plugin => ({ plugin, imports: collectImports(plugin) }));
    const specifiers = [...new Set(pluginImports.flatMap(entry => entry.imports.map(item => item.module)))];
    if (!specifiers.length) return [];

    const [target, base] = await Promise.all([SourceTree.load(repoDir, targetRef), baseRef ? SourceTree.load(repoDir, baseRef) : null]);
    if (!target || (baseRef && !base)) return [];

    const resolve = (tree: SourceTree | null) => new Map(specifiers.map(specifier => [specifier, tree?.resolveBase(aliasTarget(specifier) ?? "") ?? null]));
    const inTarget = resolve(target);
    const inBase = resolve(base);
    const present = (map: Map<string, string | null>) => [...map.values()].filter((path): path is string => Boolean(path));
    await Promise.all([target.parse(present(inTarget)), base?.parse(present(inBase))]);

    const results: PluginCompat[] = [];
    for (const { plugin, imports } of pluginImports) {
        const issues: CompatIssue[] = [];
        const reported = new Set<string>();
        const report = (issue: CompatIssue) => {
            const key = `${issue.module}|${issue.name ?? ""}`;
            if (reported.has(key) || issues.length >= MAX_ISSUES_PER_PLUGIN) return;
            reported.add(key);
            issues.push(issue);
        };

        for (const item of imports) {
            const baseFile = inBase.get(item.module);
            if (base && !baseFile) continue;
            const targetFile = inTarget.get(item.module);
            if (!targetFile) {
                report({ file: item.file, line: item.line, module: item.module });
                continue;
            }
            const now = target.exportsOf(targetFile);
            const before = base && baseFile ? base.exportsOf(baseFile) : null;
            if (!now || (base && !before) || (!base && !now.complete)) continue;
            for (const name of item.names) {
                const expected = before ? before.values.has(name) : true;
                if (expected && !now.values.has(name) && !now.types.has(name)) report({ file: item.file, line: item.line, module: item.module, name });
            }
        }
        if (issues.length) results.push({ id: plugin.id, name: plugin.name, issues });
    }
    return results;
}
