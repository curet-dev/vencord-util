import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PatchInfo } from "@shared/types";
import { describe, expect, it, vi } from "vitest";
import { tempDir } from "../test/fixtures";
import { buildPatchAsar } from "./asar";
import { detectPatch, type PatchClassifier, patchResources, unpatchResources } from "./patcher";

function setup() {
    const root = tempDir();
    const resources = join(root, "resources");
    const patcher = join(root, "Vencord", "dist", "patcher.js");
    mkdirSync(resources, { recursive: true });
    mkdirSync(join(root, "Vencord", "dist"), { recursive: true });
    writeFileSync(patcher, "");
    const original = buildPatchAsar("ORIGINAL DISCORD");
    writeFileSync(join(resources, "app.asar"), original);
    const classify: PatchClassifier = path =>
        path === patcher ? { kind: "source", patcherPath: path } : ({ kind: "other", patcherPath: path ?? undefined } as PatchInfo);
    return { root, resources, patcher, original, classify, log: vi.fn() };
}

describe("patchResources / unpatchResources", () => {
    it("detects an unpatched install", () => {
        const { resources, classify } = setup();
        expect(detectPatch(resources, classify)).toEqual({ kind: "none" });
    });

    it("patches and restores the original app.asar byte for byte", async () => {
        const { resources, patcher, original, classify, log } = setup();

        await patchResources(resources, patcher, classify, log);
        expect(detectPatch(resources, classify)).toEqual({ kind: "source", patcherPath: patcher });
        expect(readFileSync(join(resources, "_app.asar")).equals(original)).toBe(true);

        await unpatchResources(resources, log);
        expect(detectPatch(resources, classify)).toEqual({ kind: "none" });
        expect(readFileSync(join(resources, "app.asar")).equals(original)).toBe(true);
        expect(existsSync(join(resources, "_app.asar"))).toBe(false);
        expect(existsSync(join(resources, "app.asar.tmp"))).toBe(false);
    });

    it("replaces an existing foreign patch instead of stacking patches", async () => {
        const { root, resources, patcher, original, classify, log } = setup();
        const official = join(root, "official", "patcher.js");
        mkdirSync(join(root, "official"));
        writeFileSync(official, "");

        await patchResources(resources, official, classify, log);
        expect(detectPatch(resources, classify).kind).toBe("other");

        await patchResources(resources, patcher, classify, log);
        expect(detectPatch(resources, classify).kind).toBe("source");
        expect(readFileSync(join(resources, "_app.asar")).equals(original)).toBe(true);
    });

    it("refuses to patch when patcher.js has not been built", async () => {
        const { root, resources, classify, log } = setup();
        await expect(patchResources(resources, join(root, "missing", "patcher.js"), classify, log)).rejects.toThrow(/not been built/);
        expect(existsSync(join(resources, "_app.asar"))).toBe(false);
    });

    it("removes legacy app folder patches", async () => {
        const { resources, patcher, classify, log } = setup();
        mkdirSync(join(resources, "app"));
        writeFileSync(join(resources, "app", "index.js"), `require(${JSON.stringify(patcher)})`);
        expect(detectPatch(resources, classify)).toMatchObject({ kind: "source", legacy: true });

        await unpatchResources(resources, log);
        expect(existsSync(join(resources, "app"))).toBe(false);
    });
});
