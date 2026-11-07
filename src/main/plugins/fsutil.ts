import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import { UserError } from "../core/errors";

const MAX_TEXT_BYTES = 1024 * 1024;
const REMOVE_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 150 } as const;
const HASH_IGNORED = new Set([".git", "node_modules"]);

export function isDir(path: string) {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

export function isFile(path: string) {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

export function readText(path: string) {
    try {
        return statSync(path).size > MAX_TEXT_BYTES ? "" : readFileSync(path, "utf8");
    } catch {
        return "";
    }
}

function makeWritable(path: string) {
    try {
        const stat = lstatSync(path);
        if (stat.isDirectory()) for (const entry of readdirSync(path)) makeWritable(join(path, entry));
        chmodSync(path, stat.isDirectory() ? 0o777 : 0o666);
    } catch {
        return;
    }
}

export function removePath(path: string) {
    try {
        rmSync(path, REMOVE_OPTIONS);
    } catch {
        makeWritable(path);
        rmSync(path, REMOVE_OPTIONS);
    }
}

export function tryRemovePath(path: string) {
    try {
        removePath(path);
    } catch (error) {
        console.warn("Could not delete", path, error);
    }
}

export function copyPlugin(from: string, to: string) {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true, filter: source => !source.split(sep).includes("node_modules") });
}

export function movePath(from: string, to: string) {
    mkdirSync(dirname(to), { recursive: true });
    try {
        renameSync(from, to);
    } catch {
        cpSync(from, to, { recursive: true });
        tryRemovePath(from);
    }
}

export function extractZip(data: Uint8Array, destination: string) {
    const root = resolve(destination);
    for (const [name, content] of Object.entries(unzipSync(data))) {
        const target = resolve(root, name);
        if (target !== root && !target.startsWith(root + sep)) throw new UserError("Invalid ZIP archive (unsafe paths).");
        if (name.endsWith("/")) {
            mkdirSync(target, { recursive: true });
            continue;
        }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
    }
    if (!existsSync(root)) return root;
    const entries = readdirSync(root).filter(entry => entry !== "__MACOSX" && !entry.startsWith("."));
    return entries.length === 1 && isDir(join(root, entries[0])) ? join(root, entries[0]) : root;
}

export function gitBlobSha(data: Uint8Array) {
    return createHash("sha1").update(`blob ${data.byteLength}\0`).update(data).digest("hex");
}

export function sha256(data: Uint8Array) {
    return createHash("sha256").update(data).digest("hex");
}

export function hashTree(path: string) {
    const hash = createHash("sha1");
    const walk = (current: string) => {
        if (isFile(current)) {
            hash.update(relative(path, current));
            hash.update(readFileSync(current));
            return;
        }
        for (const entry of readdirSync(current).sort()) {
            if (!HASH_IGNORED.has(entry)) walk(join(current, entry));
        }
    };
    if (existsSync(path)) walk(path);
    return hash.digest("hex");
}
