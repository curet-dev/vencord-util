import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "@shared/types";
import { app } from "electron";

export const DEFAULT_REPO = "https://github.com/Vendicated/Vencord";

export const paths = {
    get userData() {
        return app.getPath("userData");
    },
    get configFile() {
        return join(app.getPath("userData"), "config.json");
    },
    get tools() {
        return join(app.getPath("userData"), "tools");
    },
    get staging() {
        return join(app.getPath("userData"), "staging");
    }
};

const defaults = (): AppConfig => ({
    vencordDir: join(homedir(), "Vencord"),
    repoUrl: DEFAULT_REPO,
    repoBranch: "",
    devBuild: false,
    restartDiscordAfterBuild: true,
    needsRebuild: false,
    targets: [],
    plugins: {},
    pluginUpdates: {},
    onboarded: false
});

let cache: AppConfig | null = null;

function readConfigFile(): Partial<AppConfig> {
    if (!existsSync(paths.configFile)) return {};
    try {
        const raw = readFileSync(paths.configFile, "utf8");
        return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    } catch (error) {
        console.error("Could not read configuration", error);
        return {};
    }
}

export function getConfig(): AppConfig {
    cache ??= { ...defaults(), ...readConfigFile() };
    return cache;
}

export function setConfig(patch: Partial<AppConfig>): AppConfig {
    const next = { ...getConfig(), ...patch };
    mkdirSync(paths.userData, { recursive: true });
    const tmp = `${paths.configFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2));
    renameSync(tmp, paths.configFile);
    cache = next;
    return next;
}
