import { type ChildProcess, spawn as spawnRaw } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import spawn from "cross-spawn";
import { log } from "./events";
import { getSpawnEnv } from "./path";

export interface ExecOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    taskId?: string;
    signal?: AbortSignal;
    quiet?: boolean;
    timeoutMs?: number;
    label?: string;
    collapseProgress?: boolean;
}

export interface ExecResult {
    code: number;
    stdout: string;
    stderr: string;
}

export class ExecError extends Error {
    constructor(
        message: string,
        readonly code: number | null,
        readonly output: string
    ) {
        super(message);
        this.name = "ExecError";
    }
}

const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const TAIL_LINES = 25;
const PNPM_PROGRESS_INTERVAL_MS = 3000;

const quoteArg = (arg: string) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);

export function killTree(pid: number) {
    try {
        if (process.platform === "win32") spawnRaw("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        else process.kill(-pid, "SIGTERM");
    } catch {
        try {
            process.kill(pid);
        } catch {
            return;
        }
    }
}

class ProgressFilter {
    private readonly seen = new Map<string, number>();
    private lastPnpmProgress = 0;

    accept(line: string) {
        if (/^Progress: resolved/.test(line) && !/done$/.test(line)) {
            const now = Date.now();
            if (now - this.lastPnpmProgress < PNPM_PROGRESS_INTERVAL_MS) return false;
            this.lastPnpmProgress = now;
            return true;
        }
        const match = line.match(/^(.*?)(\d{1,3})%/);
        if (!match || /done/i.test(line)) return true;
        const bucket = Math.floor(Number(match[2]) / 25);
        if ((this.seen.get(match[1]) ?? -1) >= bucket) return false;
        this.seen.set(match[1], bucket);
        return true;
    }
}

export function exec(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
    const { signal, taskId, quiet } = options;

    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new ExecError("Cancelled", null, ""));
            return;
        }
        if (!quiet) log(options.label ?? `$ ${[command, ...args].map(quoteArg).join(" ")}`, "cmd", taskId);

        let child: ChildProcess;
        try {
            child = spawn(command, args, {
                cwd: options.cwd,
                env: { ...getSpawnEnv(), ...options.env },
                windowsHide: true,
                detached: process.platform !== "win32",
                stdio: ["ignore", "pipe", "pipe"]
            });
        } catch (error) {
            reject(new ExecError(`Could not start ${command}: ${(error as Error).message}`, null, ""));
            return;
        }

        const filter = options.collapseProgress ? new ProgressFilter() : null;
        const tail: string[] = [];
        const captured = { out: "", err: "" };
        const pending = { out: "", err: "" };

        const emitLine = (raw: string) => {
            const line = stripVTControlCharacters(raw).trimEnd();
            if (!line.trim() || (filter && !filter.accept(line))) return;
            tail.push(line);
            if (tail.length > TAIL_LINES) tail.shift();
            if (!quiet) log(line, "out", taskId);
        };

        const onData = (stream: "out" | "err") => (chunk: Buffer) => {
            const text = chunk.toString("utf8");
            if (captured[stream].length < MAX_CAPTURE_BYTES) captured[stream] += text;
            const parts = (pending[stream] + text).split(/\r\n|\n|\r/);
            pending[stream] = parts.pop() ?? "";
            parts.forEach(emitLine);
        };
        child.stdout?.on("data", onData("out"));
        child.stderr?.on("data", onData("err"));

        let timedOut = false;
        const timer = options.timeoutMs
            ? setTimeout(() => {
                  timedOut = true;
                  if (child.pid) killTree(child.pid);
              }, options.timeoutMs)
            : undefined;
        const onAbort = () => {
            if (child.pid) killTree(child.pid);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
        };

        child.on("error", error => {
            cleanup();
            const message = (error as NodeJS.ErrnoException).code === "ENOENT" ? `"${command}" was not found` : error.message;
            reject(new ExecError(message, null, tail.join("\n")));
        });

        child.on("close", code => {
            cleanup();
            for (const stream of ["out", "err"] as const) if (pending[stream]) emitLine(pending[stream]);
            const output = tail.join("\n");
            if (signal?.aborted) reject(new ExecError("Cancelled", code, output));
            else if (timedOut) reject(new ExecError(`Timed out: "${command}"`, code, output));
            else if (code !== 0) reject(new ExecError(`"${[command, ...args].join(" ")}" failed with exit code ${code}`, code, output));
            else resolve({ code: 0, stdout: captured.out, stderr: captured.err });
        });
    });
}

export async function tryExec(command: string, args: string[], options: ExecOptions = {}) {
    try {
        return await exec(command, args, { quiet: true, timeoutMs: 20_000, ...options });
    } catch {
        return null;
    }
}

export async function gitOutput(args: string[], cwd: string, timeoutMs = 15_000) {
    const result = await tryExec("git", args, { cwd, timeoutMs });
    return result?.stdout.trim() || undefined;
}
