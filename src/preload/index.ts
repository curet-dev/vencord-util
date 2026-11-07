import type { VuApi } from "@shared/api";
import { EVENT_CHANNEL, type IpcArgs, type IpcChannel, type IpcResult } from "@shared/ipc";
import type { AppEvent } from "@shared/types";
import { contextBridge, ipcRenderer, webUtils } from "electron";

const invoke =
    <C extends IpcChannel>(channel: C) =>
    (...args: IpcArgs<C>) =>
        ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>;

const api: VuApi = {
    platform: process.platform,
    info: invoke("app:info"),
    getConfig: invoke("config:get"),
    setConfig: invoke("config:set"),
    getLogs: invoke("logs:get"),
    clearLogs: invoke("logs:clear"),
    currentTask: invoke("task:current"),
    cancelTask: invoke("task:cancel"),
    openPath: invoke("shell:openPath"),
    showItem: invoke("shell:showItem"),
    openExternal: invoke("shell:openExternal"),
    pickPlugin: invoke("dialog:pickPlugin"),
    env: {
        status: invoke("env:status"),
        install: invoke("env:install")
    },
    discord: {
        list: invoke("discord:list"),
        inject: invoke("discord:inject"),
        uninject: invoke("discord:uninject"),
        restart: invoke("discord:restart")
    },
    vencord: {
        status: invoke("vencord:status"),
        chooseDir: invoke("vencord:chooseDir"),
        install: invoke("vencord:install"),
        deps: invoke("vencord:deps"),
        build: invoke("vencord:build"),
        checkUpdates: invoke("vencord:checkUpdates"),
        update: invoke("vencord:update")
    },
    plugins: {
        list: invoke("plugins:list"),
        addUrl: invoke("plugins:addUrl"),
        addPaths: invoke("plugins:addPaths"),
        commit: invoke("plugins:commit"),
        discard: invoke("plugins:discard"),
        remove: invoke("plugins:remove"),
        setEnabled: invoke("plugins:setEnabled"),
        checkUpdates: invoke("plugins:checkUpdates"),
        update: invoke("plugins:update"),
        updateAll: invoke("plugins:updateAll")
    },
    getPathForFile: file => webUtils.getPathForFile(file),
    onEvent(listener) {
        const handler = (_event: Electron.IpcRendererEvent, event: AppEvent) => listener(event);
        ipcRenderer.on(EVENT_CHANNEL, handler);
        return () => {
            ipcRenderer.removeListener(EVENT_CHANNEL, handler);
        };
    }
};

contextBridge.exposeInMainWorld("vu", api);
