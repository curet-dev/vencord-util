import type { IpcArgs, IpcChannel, IpcResult } from "./ipc";
import type { AppEvent } from "./types";

type Invoke<C extends IpcChannel> = (...args: IpcArgs<C>) => Promise<IpcResult<C>>;

export interface VuApi {
    platform: string;
    info: Invoke<"app:info">;
    getConfig: Invoke<"config:get">;
    setConfig: Invoke<"config:set">;
    getLogs: Invoke<"logs:get">;
    clearLogs: Invoke<"logs:clear">;
    currentTask: Invoke<"task:current">;
    cancelTask: Invoke<"task:cancel">;
    openPath: Invoke<"shell:openPath">;
    showItem: Invoke<"shell:showItem">;
    openExternal: Invoke<"shell:openExternal">;
    pickPlugin: Invoke<"dialog:pickPlugin">;
    env: {
        status: Invoke<"env:status">;
        install: Invoke<"env:install">;
    };
    discord: {
        list: Invoke<"discord:list">;
        inject: Invoke<"discord:inject">;
        uninject: Invoke<"discord:uninject">;
        restart: Invoke<"discord:restart">;
    };
    vencord: {
        status: Invoke<"vencord:status">;
        chooseDir: Invoke<"vencord:chooseDir">;
        install: Invoke<"vencord:install">;
        deps: Invoke<"vencord:deps">;
        build: Invoke<"vencord:build">;
        checkUpdates: Invoke<"vencord:checkUpdates">;
        update: Invoke<"vencord:update">;
    };
    plugins: {
        list: Invoke<"plugins:list">;
        addUrl: Invoke<"plugins:addUrl">;
        addPaths: Invoke<"plugins:addPaths">;
        commit: Invoke<"plugins:commit">;
        discard: Invoke<"plugins:discard">;
        remove: Invoke<"plugins:remove">;
        setEnabled: Invoke<"plugins:setEnabled">;
        checkUpdates: Invoke<"plugins:checkUpdates">;
        update: Invoke<"plugins:update">;
        updateAll: Invoke<"plugins:updateAll">;
    };
    getPathForFile(file: File): string;
    onEvent(listener: (event: AppEvent) => void): () => void;
}
