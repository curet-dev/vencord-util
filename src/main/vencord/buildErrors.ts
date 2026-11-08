import { stripVTControlCharacters } from "node:util";
import type { BuildIssue } from "@shared/types";
import { PluginBuildError } from "../core/errors";
import { ExecError } from "../core/exec";

export interface BuildProblem extends BuildIssue {
    plugin: string;
}

const MAX_ISSUES_PER_PLUGIN = 10;
const LOOKAHEAD_LINES = 4;
const USER_PLUGIN_PATH = String.raw`(?:\.[\\/])?src[\\/]userplugins[\\/]([^\\/:\s]+)(?:[\\/]([^:\s]+))?`;

const PRETTY_ERROR = /^\s*(?:[X✘×]\s*)?\[ERROR\]\s*(.+?)\s*$/;
const PRETTY_LOCATION = new RegExp(String.raw`^\s*${USER_PLUGIN_PATH}:(\d+):\d+:\s*$`);
const SUMMARY_ERROR = new RegExp(String.raw`^\s*${USER_PLUGIN_PATH}:(\d+):\d+:\s*ERROR:\s*(.+?)\s*$`);
const INVALID_PLUGIN = new RegExp(String.raw`Invalid plugin\s+${USER_PLUGIN_PATH}:\s*(.+?)\s*$`);

/** Extracts esbuild errors that point into src/userplugins from the output of `pnpm build`. */
export function parseBuildProblems(output: string): BuildProblem[] {
    const lines = stripVTControlCharacters(output).split(/\r?\n/);
    const problems: BuildProblem[] = [];
    const seen = new Set<string>();
    const add = (plugin: string, file: string | undefined, line: number | undefined, message: string) => {
        const key = `${plugin}|${file}|${line}|${message}`;
        if (seen.has(key)) return;
        seen.add(key);
        problems.push({ plugin, file: file ?? plugin, line, message });
    };

    for (const [index, text] of lines.entries()) {
        const summary = text.match(SUMMARY_ERROR);
        const invalid = summary ? null : text.match(INVALID_PLUGIN);
        const pretty = summary || invalid ? null : text.match(PRETTY_ERROR);
        if (summary) add(summary[1], summary[2], Number(summary[3]), summary[4]);
        else if (invalid) add(invalid[1], invalid[2], undefined, invalid[3]);
        else if (pretty) {
            const location = lines
                .slice(index + 1, index + 1 + LOOKAHEAD_LINES)
                .map(next => next.match(PRETTY_LOCATION))
                .find(Boolean);
            if (location) add(location[1], location[2], Number(location[3]), pretty[1]);
        }
    }
    return problems;
}

function describeIssue(issue: BuildIssue) {
    return `${issue.message} (${issue.file}${issue.line ? `:${issue.line}` : ""})`;
}

/**
 * Turns a failed `pnpm build` into a {@link PluginBuildError} when user plugins caused it, so the app can say which plugins
 * broke the build instead of only reporting the exit code. Other errors are returned unchanged.
 */
export function explainBuildFailure(error: unknown, pluginName: (id: string) => string = id => id): unknown {
    if (!(error instanceof ExecError) || error.message === "Cancelled") return error;
    const problems = parseBuildProblems(error.fullOutput);
    if (!problems.length) return error;

    const issues: Record<string, BuildIssue[]> = {};
    for (const { plugin, ...issue } of problems) {
        issues[plugin] ??= [];
        if (issues[plugin].length < MAX_ISSUES_PER_PLUGIN) issues[plugin].push(issue);
    }

    const ids = Object.keys(issues);
    const names = ids.map(pluginName);
    const message =
        ids.length === 1 ? `The build failed because of the plugin “${names[0]}”.` : `The build failed because of ${ids.length} plugins: ${names.join(", ")}.`;
    const removedApi = problems.some(problem => /No matching export|Could not resolve "@/.test(problem.message));
    const details = ids.map(
        (id, index) => `${names[index]}: ${describeIssue(issues[id][0])}${issues[id].length > 1 ? ` – and ${issues[id].length - 1} more` : ""}`
    );
    const advice = removedApi
        ? "The plugin uses Vencord functions that were renamed or removed. Update it, ask its author for a fix or disable it."
        : "Update or disable the plugin.";
    return new PluginBuildError(message, `${advice}\n${details.join("\n")}`, issues);
}
