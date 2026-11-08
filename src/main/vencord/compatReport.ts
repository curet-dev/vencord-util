import type { CompatIssue, CompatReport, PluginCompat } from "@shared/types";
import { getConfig } from "../core/config";
import { gitOutput } from "../core/exec";
import { which } from "../core/path";
import { listPlugins } from "../plugins/library";
import { analyzeCompat } from "./compat";
import { isVencordRepo, vencordDir } from "./repo";

/** Checks the enabled user plugins against the installed Vencord version and – if there is one – the pending update. */
export async function getCompatReport(): Promise<CompatReport | null> {
    const dir = vencordDir();
    if (!isVencordRepo(dir) || !which("git")) return null;
    const plugins = listPlugins()
        .filter(plugin => plugin.enabled)
        .map(({ id, name, path }) => ({ id, name, path }));
    if (!plugins.length) return { current: [] };

    const behind = getConfig().lastUpdate?.behind ?? 0;
    const upstream = behind > 0 ? await gitOutput(["rev-parse", "--verify", "--quiet", "@{u}"], dir) : undefined;
    const [current, update] = await Promise.all([analyzeCompat(dir, plugins, "HEAD"), upstream ? analyzeCompat(dir, plugins, upstream, "HEAD") : null]);
    return { current, update: upstream && update ? { target: upstream.slice(0, 8), plugins: update } : undefined };
}

export function describeCompatIssue(issue: CompatIssue) {
    const where = `${issue.file}:${issue.line}`;
    return issue.name ? `“${issue.name}” from ${issue.module} (${where})` : `the module ${issue.module} (${where})`;
}

export const describePluginCompat = (plugin: PluginCompat) => `${plugin.name ?? plugin.id} uses ${plugin.issues.map(describeCompatIssue).join(", ")}`;
