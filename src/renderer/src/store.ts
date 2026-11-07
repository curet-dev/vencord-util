import type { AppConfig, DiscordInstall, EnvStatus, LogLine, StageResult, TaskResult, TaskState, UserPlugin, VencordStatus } from "@shared/types";
import { create } from "zustand";

export type Page = "dashboard" | "install" | "plugins" | "console" | "settings";
type Scope = "config" | "env" | "discord" | "vencord" | "plugins";

export interface Toast {
    id: number;
    kind: "success" | "error" | "info";
    title: string;
    text?: string;
}

interface State {
    page: Page;
    config: AppConfig | null;
    env: EnvStatus | null;
    discord: DiscordInstall[];
    vencord: VencordStatus | null;
    plugins: UserPlugin[];
    task: TaskState | null;
    logs: LogLine[];
    toasts: Toast[];
    loaded: Record<Scope, boolean>;
    stage: StageResult | null;
    logOpen: boolean;
    setPage(p: Page): void;
    setStage(s: StageResult | null): void;
    setLogOpen(open: boolean): void;
    refresh(...scopes: Scope[]): Promise<void>;
    toast(t: Omit<Toast, "id">): void;
    dismissToast(id: number): void;
}

let toastId = 1;
const MAX_LOGS = 4000;

export const useStore = create<State>((set, get) => ({
    page: "dashboard",
    config: null,
    env: null,
    discord: [],
    vencord: null,
    plugins: [],
    task: null,
    logs: [],
    toasts: [],
    loaded: { config: false, env: false, discord: false, vencord: false, plugins: false },
    stage: null,
    logOpen: false,
    setPage: page => set({ page }),
    setStage: stage => set({ stage }),
    setLogOpen: logOpen => set({ logOpen }),

    async refresh(...scopes) {
        const all: Scope[] = scopes.length ? scopes : ["config", "env", "discord", "vencord", "plugins"];
        const jobs: Promise<void>[] = [];
        const mark = (s: Scope) => set(st => ({ loaded: { ...st.loaded, [s]: true } }));
        for (const s of all) {
            const job = (async () => {
                try {
                    switch (s) {
                        case "config":
                            set({ config: await window.vu.getConfig() });
                            break;
                        case "env":
                            set({ env: await window.vu.env.status() });
                            break;
                        case "discord":
                            set({ discord: await window.vu.discord.list() });
                            break;
                        case "vencord":
                            set({ vencord: await window.vu.vencord.status() });
                            break;
                        case "plugins":
                            set({ plugins: await window.vu.plugins.list() });
                            break;
                    }
                } catch (e) {
                    console.error(`refresh ${s}`, e);
                } finally {
                    mark(s);
                }
            })();
            jobs.push(job);
        }
        await Promise.all(jobs);
    },

    toast(t) {
        const id = toastId++;
        set(st => ({ toasts: [...st.toasts, { ...t, id }].slice(-4) }));
        setTimeout(() => get().dismissToast(id), t.kind === "error" ? 9000 : 4500);
    },
    dismissToast(id) {
        set(st => ({ toasts: st.toasts.filter(t => t.id !== id) }));
    }
}));

let pending = new Set<Scope>();
let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleRefresh(scopes: Scope[]) {
    for (const s of scopes) pending.add(s);
    if (timer) return;
    timer = setTimeout(() => {
        const list = [...pending];
        pending = new Set();
        timer = null;
        useStore.getState().refresh(...list);
    }, 120);
}

export function initStore() {
    const st = useStore.getState();
    st.refresh();
    window.vu.getLogs().then(logs => useStore.setState({ logs }));
    window.vu.currentTask().then(task => task && useStore.setState({ task }));

    return window.vu.onEvent(e => {
        if (e.type === "log") {
            useStore.setState(s => {
                const logs = s.logs.length >= MAX_LOGS ? s.logs.slice(-MAX_LOGS + 500) : s.logs.slice();
                logs.push(e.line);
                return { logs };
            });
        } else if (e.type === "task") {
            const prev = useStore.getState().task;
            useStore.setState({ task: e.task });
            if (e.task.status !== "running" && prev?.status === "running") {
                scheduleRefresh(["vencord", "discord", "plugins", "config"]);
            }
        } else if (e.type === "changed") {
            scheduleRefresh(e.scope);
        }
    });
}

export const useBusy = () => useStore(s => s.task?.status === "running");

export async function act<T>(promise: Promise<TaskResult<T>>, success?: string | ((data: T | undefined) => string | null)) {
    const res = await promise;
    const { toast } = useStore.getState();
    if (res.ok) {
        const msg = typeof success === "function" ? success(res.data) : success;
        if (msg) toast({ kind: "success", title: msg });
    } else if (res.error) {
        toast({ kind: "error", title: res.error, text: res.hint });
    }
    return res;
}
