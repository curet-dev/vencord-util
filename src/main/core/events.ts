import { EVENT_CHANNEL } from "@shared/ipc";
import type { AppEvent, ChangeScope, LogLevel, LogLine } from "@shared/types";
import { BrowserWindow } from "electron";

const MAX_LINES = 4000;
const lines: LogLine[] = [];
let nextId = 1;

export function emit(event: AppEvent) {
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(EVENT_CHANNEL, event);
    }
}

export function log(text: string, level: LogLevel = "info", taskId?: string) {
    for (const part of text.split(/\r?\n/)) {
        if (!part.trim()) continue;
        const line: LogLine = { id: nextId++, level, text: part, ts: Date.now(), taskId };
        lines.push(line);
        emit({ type: "log", line });
    }
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

export const getLogs = (): LogLine[] => [...lines];

export function clearLogs() {
    lines.length = 0;
}

export function notifyChanged(...scope: ChangeScope[]) {
    emit({ type: "changed", scope });
}
