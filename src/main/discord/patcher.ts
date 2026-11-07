import { basename, join } from "node:path";
import type { LogLevel, PatchInfo } from "@shared/types";
import rawFs from "original-fs";
import { UserError } from "../core/errors";
import { parseRequirePath, readAsarFile, writePatchAsar } from "./asar";

export type PatchClassifier = (patcherPath: string | null) => PatchInfo;
export type PatchLogger = (text: string, level?: LogLevel) => void;

const RENAME_ATTEMPTS = 8;
const RENAME_RETRY_MS = 500;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const files = (resources: string) => ({
    app: join(resources, "app.asar"),
    original: join(resources, "_app.asar"),
    backup: join(resources, "app.asar.tmp"),
    legacyDir: join(resources, "app")
});

function findLegacyPatch(resources: string) {
    const { legacyDir } = files(resources);
    try {
        if (!rawFs.statSync(legacyDir).isDirectory()) return null;
        const patcherPath = parseRequirePath(rawFs.readFileSync(join(legacyDir, "index.js"), "utf8"));
        return patcherPath && /patcher\.js$/i.test(patcherPath) ? { dir: legacyDir, patcherPath } : null;
    } catch {
        return null;
    }
}

export function detectPatch(resources: string, classify: PatchClassifier): PatchInfo {
    const legacy = findLegacyPatch(resources);
    if (legacy) return { ...classify(legacy.patcherPath), legacy: true };

    const { app, original } = files(resources);
    if (!rawFs.existsSync(original)) return { kind: "none" };
    const indexJs = readAsarFile(app, "index.js");
    return classify(indexJs ? parseRequirePath(indexJs) : null);
}

async function renameWithRetry(from: string, to: string) {
    for (let attempt = 1; ; attempt++) {
        try {
            rawFs.renameSync(from, to);
            return;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            const retryable = code === "EBUSY" || (process.platform === "win32" && code === "EPERM");
            if (!retryable || attempt >= RENAME_ATTEMPTS) throw error;
            await sleep(RENAME_RETRY_MS);
        }
    }
}

function rollback(renames: [string, string][], log: PatchLogger) {
    for (const [from, to] of [...renames].reverse()) {
        try {
            rawFs.renameSync(to, from);
        } catch {
            log(`Failed to restore ${basename(from)} – you may need to reinstall Discord.`, "error");
        }
    }
}

export async function unpatchResources(resources: string, log: PatchLogger) {
    const { app, original, backup } = files(resources);

    const legacy = findLegacyPatch(resources);
    if (legacy) {
        log(`Removing legacy patch folder ${legacy.dir}`);
        rawFs.rmSync(legacy.dir, { recursive: true, force: true });
    }
    if (!rawFs.existsSync(original)) return;

    const renames: [string, string][] = [];
    try {
        rawFs.rmSync(backup, { force: true });
        if (rawFs.existsSync(app)) {
            await renameWithRetry(app, backup);
            renames.push([app, backup]);
        }
        await renameWithRetry(original, app);
        renames.push([original, app]);
    } catch (error) {
        rollback(renames, log);
        throw error;
    }

    try {
        rawFs.rmSync(backup, { force: true });
    } catch {
        log("Could not delete temporary file app.asar.tmp (harmless).", "warn");
    }
}

export async function patchResources(resources: string, patcherPath: string, classify: PatchClassifier, log: PatchLogger) {
    if (!rawFs.existsSync(patcherPath)) {
        throw new UserError("Vencord has not been built yet (dist/patcher.js is missing).", "Build Vencord first, then try again.");
    }
    const { app, original } = files(resources);

    if (detectPatch(resources, classify).kind !== "none" || rawFs.existsSync(original)) {
        log("Removing the existing patch first.");
        await unpatchResources(resources, log);
    }
    if (!rawFs.existsSync(app)) throw new UserError(`No app.asar found in ${resources}.`, "Reinstall Discord.");

    await renameWithRetry(app, original);
    try {
        writePatchAsar(app, patcherPath);
    } catch (error) {
        log("Writing app.asar failed – reverting changes.", "error");
        rawFs.rmSync(app, { force: true });
        rollback([[app, original]], log);
        throw error;
    }

    const result = detectPatch(resources, classify);
    if (result.kind === "none" || result.kind === "broken") {
        throw new Error(`Could not verify the patch (status: ${result.kind}).`);
    }
}
