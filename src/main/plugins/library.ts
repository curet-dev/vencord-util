import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PluginSource, UserPlugin } from "@shared/types";
import { getConfig, setConfig } from "../core/config";
import { UserError } from "../core/errors";
import { notifyChanged } from "../core/events";
import { userPluginsDir } from "../vencord/repo";
import { findPluginIndex } from "./detect";
import { isDir, readText, removePath } from "./fsutil";
import { parsePluginMeta } from "./meta";
import { CODE_FILE } from "./source";

export const DISABLED_DIR = ".disabled";
const NATIVE_FILES = ["native.ts", "native.tsx", "native.js"];

export interface PluginLocation {
    path: string;
    enabled: boolean;
}

export const pluginPath = (id: string, enabled: boolean) => (enabled ? join(userPluginsDir(), id) : join(userPluginsDir(), DISABLED_DIR, id));

export const pluginExists = (id: string) => existsSync(pluginPath(id, true)) || existsSync(pluginPath(id, false));

export function locatePlugin(id: string): PluginLocation {
    if (!id || /[\\/]/.test(id) || id === "." || id === "..") throw new UserError("Invalid plugin name.");
    for (const enabled of [true, false]) {
        const path = pluginPath(id, enabled);
        if (existsSync(path)) return { path, enabled };
    }
    throw new UserError(`Plugin “${id}” was not found.`);
}

export const isUpdatable = (plugin: Pick<UserPlugin, "isGit" | "source">) => plugin.isGit || (Boolean(plugin.source?.url) && plugin.source?.type !== "local");

export function describePlugin(id: string, { path, enabled }: PluginLocation): UserPlugin | null {
    const { plugins, pluginUpdates } = getConfig();
    const folder = isDir(path);
    if (!folder && (!CODE_FILE.test(id) || /\.d\.ts$/i.test(id))) return null;

    const index = folder ? findPluginIndex(path) : path;
    const meta = parsePluginMeta(index ? readText(index) : "");
    const isGit = folder && existsSync(join(path, ".git"));
    const source = plugins[id];
    return {
        id,
        kind: folder ? "folder" : "file",
        enabled,
        path,
        name: meta.name,
        description: index ? meta.description : "⚠ No index.ts/index.tsx found – this folder will make the build fail.",
        authors: meta.authors,
        isGit,
        hasNative: folder && NATIVE_FILES.some(file => existsSync(join(path, file))),
        updatable: isUpdatable({ isGit, source }),
        source,
        update: pluginUpdates[id]
    };
}

export function listPlugins(): UserPlugin[] {
    const plugins: UserPlugin[] = [];
    for (const enabled of [true, false]) {
        const dir = enabled ? userPluginsDir() : join(userPluginsDir(), DISABLED_DIR);
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            continue;
        }
        for (const id of entries) {
            if (id.startsWith(".") || id.startsWith("_")) continue;
            const plugin = describePlugin(id, { path: join(dir, id), enabled });
            if (plugin) plugins.push(plugin);
        }
    }
    return plugins.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, "en"));
}

export function savePluginSource(id: string, source: PluginSource | undefined) {
    const { plugins, pluginUpdates } = getConfig();
    const nextPlugins = { ...plugins };
    const nextUpdates = { ...pluginUpdates };
    if (source) nextPlugins[id] = source;
    else delete nextPlugins[id];
    delete nextUpdates[id];
    setConfig({ plugins: nextPlugins, pluginUpdates: nextUpdates });
}

export function removePlugin(id: string) {
    removePath(locatePlugin(id).path);
    savePluginSource(id, undefined);
    setConfig({ needsRebuild: true });
    notifyChanged("plugins", "config");
}

export function setPluginEnabled(id: string, enabled: boolean) {
    const location = locatePlugin(id);
    if (location.enabled === enabled) return;
    const target = pluginPath(id, enabled);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(location.path, target);
    setConfig({ needsRebuild: true });
    notifyChanged("plugins", "config");
}
