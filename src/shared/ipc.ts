import type {
    AppConfig,
    AppInfo,
    AppUpdateState,
    CompatReport,
    DiscordInstall,
    EditableConfig,
    EnvStatus,
    InstallOptions,
    LogLine,
    PluginInstallOutcome,
    PluginLinkResult,
    TaskResult,
    TaskState,
    ToolName,
    UpdateInfo,
    UserPlugin,
    VencordStatus
} from "./types";

export const EVENT_CHANNEL = "vu:event";

export interface IpcContract {
    "app:info": () => AppInfo;
    "app:quit": () => void;
    "appUpdate:state": () => AppUpdateState;
    "appUpdate:check": () => AppUpdateState;
    "appUpdate:install": () => TaskResult;
    "config:get": () => AppConfig;
    "config:set": (patch: EditableConfig) => AppConfig;
    "logs:get": () => LogLine[];
    "logs:clear": () => void;
    "task:current": () => TaskState | null;
    "task:cancel": () => void;
    "shell:openPath": (path: string) => string;
    "shell:showItem": (path: string) => void;
    "shell:openExternal": (url: string) => void;
    "dialog:pickPlugin": (mode: "file" | "folder") => string[];
    "env:status": () => EnvStatus;
    "env:install": (tool: ToolName) => TaskResult;
    "discord:list": () => DiscordInstall[];
    "discord:inject": (ids: string[]) => TaskResult;
    "discord:uninject": (ids: string[]) => TaskResult;
    "discord:restart": (id: string) => TaskResult;
    "vencord:status": () => VencordStatus;
    "vencord:chooseDir": () => string | null;
    "vencord:install": (options: InstallOptions) => TaskResult;
    "vencord:deps": () => TaskResult;
    "vencord:build": (restart?: boolean) => TaskResult;
    "vencord:checkUpdates": () => TaskResult<UpdateInfo>;
    "vencord:update": (options?: { stash?: boolean }) => TaskResult;
    "vencord:compat": () => CompatReport | null;
    "plugins:list": () => UserPlugin[];
    "plugins:addUrl": (url: string) => TaskResult<PluginInstallOutcome>;
    "plugins:addPaths": (paths: string[]) => TaskResult<PluginInstallOutcome>;
    "plugins:commit": (stagingId: string, ids: string[]) => TaskResult<string[]>;
    "plugins:discard": (stagingId: string) => void;
    "plugins:remove": (id: string) => TaskResult;
    "plugins:setEnabled": (id: string, enabled: boolean) => TaskResult;
    "plugins:checkUpdates": () => TaskResult<number>;
    "plugins:update": (id: string) => TaskResult<boolean>;
    "plugins:updateAll": () => TaskResult<number>;
    "plugins:linkSource": (id: string, url: string) => TaskResult<PluginLinkResult>;
}

export type IpcChannel = keyof IpcContract;
export type IpcArgs<C extends IpcChannel> = Parameters<IpcContract[C]>;
export type IpcResult<C extends IpcChannel> = ReturnType<IpcContract[C]>;
