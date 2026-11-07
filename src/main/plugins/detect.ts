import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../core/errors";
import { isDir, isFile, readText } from "./fsutil";
import { parsePluginMeta } from "./meta";
import { CODE_FILE, isIndexFile, PLUGIN_INDEX_FILES } from "./source";

export interface FoundPlugin {
    path: string;
    kind: "folder" | "file";
}

const MAX_DEPTH = 4;
const MAX_RESULTS = 200;
const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".github", ".vscode", ".idea"]);
const VENCORD_FORKS = new Set(["vencord", "equicord"]);

export function findPluginIndex(dir: string) {
    return PLUGIN_INDEX_FILES.map(file => join(dir, file)).find(isFile) ?? null;
}

function assertNotVencordFork(root: string) {
    let name: string | undefined;
    try {
        name = String(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name).toLowerCase();
    } catch {
        return;
    }
    if (VENCORD_FORKS.has(name) && isDir(join(root, "src", "plugins"))) {
        throw new UserError("This is a complete Vencord fork, not a single plugin.", "You can set a fork as the repository URL in Settings.");
    }
}

function isSingleFilePlugin(file: string) {
    const source = readText(file);
    return /definePlugin\s*\(/.test(source) && /export\s+default/.test(source);
}

export function findPluginCandidates(root: string): FoundPlugin[] {
    if (isFile(root)) return [{ path: root, kind: "file" }];
    if (findPluginIndex(root)) return [{ path: root, kind: "folder" }];
    assertNotVencordFork(root);

    const found: FoundPlugin[] = [];
    const walk = (dir: string, depth: number) => {
        if (depth > MAX_DEPTH || found.length >= MAX_RESULTS) return;
        let entries: string[];
        try {
            entries = readdirSync(dir).sort();
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.startsWith(".") || SKIPPED_DIRS.has(entry)) continue;
            const path = join(dir, entry);
            if (isDir(path)) {
                const index = findPluginIndex(path);
                if (index && parsePluginMeta(readText(index)).isPlugin) found.push({ path, kind: "folder" });
                else walk(path, depth + 1);
            } else if (CODE_FILE.test(entry) && !/\.d\.ts$/i.test(entry) && !isIndexFile(entry) && isSingleFilePlugin(path)) {
                found.push({ path, kind: "file" });
            }
        }
    };
    walk(root, 0);
    return found;
}
