import type { InstallOptions, PluginInstallOutcome, StageResult, ToolName } from "@shared/types";
import { getConfig, setConfig } from "./core/config";
import { UserError } from "./core/errors";
import { notifyChanged } from "./core/events";
import { refreshPath } from "./core/path";
import { runTask, type TaskContext } from "./core/tasks";
import { getEnvStatus, installTool, toolLabel } from "./core/tools";
import { closeDiscord, getInstall, injectVencord, launchDiscord, listDiscordInstalls, removeVencord } from "./discord/discord";
import { commitStaging, stageFromPaths, stageFromUrl } from "./plugins/staging";
import { pluginsToUpdate, updatePlugin } from "./plugins/updates";
import { buildVencord, cloneVencord, installDependencies, pullVencord } from "./vencord/repo";

const PLUGIN_STEPS = [
    { id: "fetch", label: "Download" },
    { id: "analyze", label: "Detect plugins" },
    { id: "install", label: "Install" }
];

async function restartSourceInstalls(ctx: TaskContext) {
    const installs = (await listDiscordInstalls()).filter(install => install.patch.kind === "source");
    for (const install of installs) {
        await closeDiscord(install, ctx);
        ctx.log(`Starting ${install.name} …`);
        launchDiscord(install);
    }
    return installs.length;
}

async function injectInto(ids: string[], ctx: TaskContext) {
    if (!ids.length) throw new UserError("No Discord installation selected.");
    for (const id of ids) {
        await closeDiscord(await getInstall(id), ctx);
        await injectVencord(await getInstall(id), ctx);
    }
    for (const id of ids) launchDiscord(await getInstall(id));
    notifyChanged("discord");
}

async function buildAndMaybeRestart(ctx: TaskContext, restart: boolean) {
    ctx.step("build");
    await buildVencord(ctx);
    if (!restart) return;
    ctx.step("restart");
    if (!(await restartSourceInstalls(ctx))) ctx.step("restart", "skipped", "no injected installation");
}

export const installToolTask = (tool: ToolName) =>
    runTask(`Install ${toolLabel(tool)}`, [{ id: "install", label: "Install" }], async ctx => {
        ctx.step("install");
        await installTool(tool, ctx);
        notifyChanged("env");
    });

export const injectTask = (ids: string[]) =>
    runTask("Inject Vencord into Discord", [{ id: "inject", label: "Patch Discord" }], async ctx => {
        ctx.step("inject");
        await injectInto(ids, ctx);
    });

export const uninjectTask = (ids: string[]) =>
    runTask("Remove Vencord from Discord", [{ id: "uninject", label: "Remove patch" }], async ctx => {
        ctx.step("uninject");
        for (const id of ids) {
            const wasRunning = await closeDiscord(await getInstall(id), ctx);
            const install = await getInstall(id);
            await removeVencord(install, ctx);
            if (wasRunning) launchDiscord(install);
        }
        notifyChanged("discord");
    });

export const restartDiscordTask = (id: string) =>
    runTask("Restart Discord", [{ id: "restart", label: "Restart" }], async ctx => {
        ctx.step("restart");
        const install = await getInstall(id);
        await closeDiscord(install, ctx);
        launchDiscord(install);
        notifyChanged("discord");
    });

export const installVencordTask = (options: InstallOptions) =>
    runTask(
        "Install Vencord from source",
        [
            { id: "env", label: "Check requirements" },
            { id: "official", label: "Remove official Vencord" },
            { id: "clone", label: "Download source code" },
            { id: "deps", label: "Install dependencies" },
            { id: "build", label: "Build Vencord" },
            { id: "inject", label: "Inject into Discord" }
        ],
        async ctx => {
            ctx.step("env");
            await refreshPath();
            const missing = Object.values((await getEnvStatus()).tools).filter(tool => !tool.ok);
            if (missing.length) {
                throw new UserError(
                    `Missing requirements: ${missing.map(tool => `${tool.name} (${tool.problem})`).join(", ")}`,
                    "Install the missing tools using the buttons in the “Requirements” section."
                );
            }

            ctx.step("official");
            const foreign = (await listDiscordInstalls()).filter(install => ["official", "other", "broken"].includes(install.patch.kind));
            if (options.removeOfficial && foreign.length) {
                for (const install of foreign) {
                    await closeDiscord(install, ctx);
                    await removeVencord(await getInstall(install.id), ctx);
                }
                notifyChanged("discord");
            } else {
                ctx.step("official", "skipped", foreign.length ? "skipped" : "none found");
            }

            ctx.step("clone");
            if (!(await cloneVencord(ctx))) ctx.step("clone", "running", "existing clone");

            ctx.step("deps");
            await installDependencies(ctx);

            ctx.step("build");
            await buildVencord(ctx);

            if (options.inject && options.targets.length) {
                ctx.step("inject");
                setConfig({ targets: options.targets });
                await injectInto(options.targets, ctx);
            } else {
                ctx.step("inject", "skipped");
            }
            setConfig({ onboarded: true });
            notifyChanged("vencord", "discord", "config", "env");
        }
    );

export const installDependenciesTask = () =>
    runTask("Install dependencies", [{ id: "deps", label: "pnpm install" }], async ctx => {
        ctx.step("deps");
        await installDependencies(ctx);
        notifyChanged("vencord");
    });

export const buildTask = (restart?: boolean) =>
    runTask(
        "Build Vencord",
        [
            { id: "build", label: "Build Vencord" },
            { id: "restart", label: "Restart Discord" }
        ],
        async ctx => {
            await buildAndMaybeRestart(ctx, restart ?? getConfig().restartDiscordAfterBuild);
            notifyChanged("vencord", "discord");
        }
    );

export const updateVencordTask = (stash: boolean) =>
    runTask(
        "Update Vencord",
        [
            { id: "pull", label: "Pull latest changes" },
            { id: "deps", label: "Update dependencies" },
            { id: "build", label: "Build Vencord" },
            { id: "restart", label: "Restart Discord" }
        ],
        async ctx => {
            ctx.step("pull");
            if (!(await pullVencord(ctx, stash))) ctx.log("No new commits – rebuilding anyway.");
            ctx.step("deps");
            await installDependencies(ctx);
            await buildAndMaybeRestart(ctx, getConfig().restartDiscordAfterBuild);
            notifyChanged("vencord", "discord", "config");
        }
    );

function completeStage(stage: StageResult, ctx: TaskContext): PluginInstallOutcome {
    if (stage.candidates.length === 1 && !stage.candidates[0].exists) {
        ctx.step("install");
        const installed = commitStaging(stage.stagingId, [stage.candidates[0].id]);
        ctx.log(`Installed: ${installed.join(", ")}`, "success");
        return { installed };
    }
    ctx.step("install", "skipped", "selection required");
    ctx.log(`${stage.candidates.length} plugin(s) found – selection required.`);
    return { installed: [], stage };
}

export const addPluginFromUrlTask = (url: string) =>
    runTask("Install plugin from link", PLUGIN_STEPS, async ctx => completeStage(await stageFromUrl(url, ctx), ctx));

export const addPluginFromPathsTask = (paths: string[]) =>
    runTask("Install plugin from file", PLUGIN_STEPS.slice(1), async ctx => completeStage(await stageFromPaths(paths, ctx), ctx));

export const updatePluginTask = (id: string) =>
    runTask("Update plugin", [{ id: "update", label: id }], async ctx => {
        ctx.step("update");
        return updatePlugin(id, ctx);
    });

export const updateAllPluginsTask = () =>
    runTask("Update plugins", [{ id: "update", label: "Update plugins" }], async ctx => {
        ctx.step("update");
        const plugins = pluginsToUpdate();
        if (!plugins.length) {
            ctx.log("All plugins are up to date.");
            return 0;
        }
        let changed = 0;
        const failed: string[] = [];
        for (const plugin of plugins) {
            const label = plugin.name ?? plugin.id;
            ctx.step("update", "running", label);
            try {
                if (await updatePlugin(plugin.id, ctx)) changed++;
            } catch (error) {
                failed.push(label);
                ctx.log(`${label}: ${(error as Error).message}`, "error");
            }
        }
        if (failed.length) throw new UserError(`${failed.length} plugin(s) could not be updated: ${failed.join(", ")}`);
        ctx.step("update", "done", `${changed} updated`);
        return changed;
    });
