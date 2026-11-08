import type { LogLevel, StepStatus, TaskResult, TaskState, TaskStatus } from "@shared/types";
import { hintFor, PluginBuildError } from "./errors";
import { emit, log } from "./events";
import { ExecError, type ExecOptions, type ExecResult, exec } from "./exec";

export interface TaskContext {
    readonly id: string;
    readonly signal: AbortSignal;
    log(text: string, level?: LogLevel): void;
    step(id: string, status?: StepStatus, detail?: string): void;
    exec(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
}

export interface TaskStepDefinition {
    id: string;
    label: string;
}

interface ActiveTask {
    state: TaskState;
    controller: AbortController;
}

let active: ActiveTask | null = null;
let counter = 0;

export const getCurrentTask = () => active?.state ?? null;
export const isBusy = () => active !== null;

export function cancelCurrentTask() {
    active?.controller.abort();
}

function publish(state: TaskState) {
    emit({ type: "task", task: { ...state, steps: state.steps.map(step => ({ ...step })) } });
}

function createContext(state: TaskState, controller: AbortController): TaskContext {
    return {
        id: state.id,
        signal: controller.signal,
        log: (text, level = "info") => log(text, level, state.id),
        step(id, status = "running", detail) {
            const step = state.steps.find(s => s.id === id);
            if (!step) return;
            if (status === "running") {
                for (const other of state.steps) if (other.status === "running" && other.id !== id) other.status = "done";
                if (step.status !== "running") log(`▶ ${step.label}`, "info", state.id);
            }
            step.status = status;
            if (detail !== undefined) step.detail = detail;
            publish(state);
        },
        exec: (command, args, options = {}) => exec(command, args, { taskId: state.id, signal: controller.signal, ...options })
    };
}

function settle(state: TaskState, status: TaskStatus) {
    const fallback: StepStatus = status === "success" ? "done" : status === "cancelled" ? "skipped" : "error";
    for (const step of state.steps) {
        if (step.status === "running") step.status = fallback;
        else if (step.status === "pending" && status === "success") step.status = "skipped";
    }
    state.status = status;
    state.endedAt = Date.now();
    publish(state);
}

export async function runTask<T>(title: string, steps: TaskStepDefinition[], run: (ctx: TaskContext) => Promise<T>): Promise<TaskResult<T>> {
    if (active) {
        return { ok: false, error: `Another task is already running: “${active.state.title}”. Please wait until it has finished.` };
    }

    const controller = new AbortController();
    const state: TaskState = {
        id: `task-${Date.now()}-${++counter}`,
        title,
        status: "running",
        steps: steps.map(step => ({ ...step, status: "pending" })),
        startedAt: Date.now()
    };
    active = { state, controller };
    log(`━━ ${title} ━━`, "info", state.id);
    publish(state);

    try {
        const data = await run(createContext(state, controller));
        settle(state, "success");
        log(`✔ ${title} – done`, "success", state.id);
        return { ok: true, data };
    } catch (error) {
        const cancelled = controller.signal.aborted;
        state.error = cancelled ? "Cancelled by user" : (error as Error).message;
        state.hint = cancelled ? undefined : hintFor(error);
        if (error instanceof PluginBuildError && !cancelled) state.brokenPlugins = error.brokenPlugins;
        if (error instanceof ExecError && error.output && !error.logged && !cancelled) {
            log("Last output:", "warn", state.id);
            log(error.output, "err", state.id);
        }
        log(`✖ ${state.error}`, cancelled ? "warn" : "error", state.id);
        if (state.hint) log(`Hint: ${state.hint}`, "warn", state.id);
        settle(state, cancelled ? "cancelled" : "error");
        return { ok: false, error: state.error, hint: state.hint };
    } finally {
        active = null;
    }
}
