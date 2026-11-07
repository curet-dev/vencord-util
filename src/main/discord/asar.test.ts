import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../test/fixtures";
import { buildPatchAsar, parseRequirePath, readAsarFile, writePatchAsar } from "./asar";

describe("buildPatchAsar", () => {
    it("writes the pickle header exactly like the official installer", () => {
        const archive = buildPatchAsar("/vencord/dist/patcher.js");
        const headerBytes = archive.readInt32LE(12);
        const aligned = Math.ceil(headerBytes / 4) * 4;

        expect(archive.readInt32LE(0)).toBe(4);
        expect(archive.readInt32LE(4)).toBe(aligned + 8);
        expect(archive.readInt32LE(8)).toBe(aligned + 4);
        expect(archive.subarray(16 + headerBytes, 16 + aligned).toString()).toBe("0".repeat(aligned - headerBytes));
        expect(JSON.parse(archive.subarray(16, 16 + headerBytes).toString())).toEqual({
            files: {
                "index.js": { size: 35, offset: "0" },
                "package.json": { size: 43, offset: "35" }
            }
        });
    });

    it("round-trips paths containing quotes, backslashes and non-ASCII characters", () => {
        const patcher = 'C:\\Users\\Jürgen "J" Ä\\Vencord\\dist\\patcher.js';
        const file = join(tempDir(), "app.asar");
        writePatchAsar(file, patcher);

        const indexJs = readAsarFile(file, "index.js");
        expect(indexJs).toBe(`require(${JSON.stringify(patcher)})`);
        expect(parseRequirePath(indexJs ?? "")).toBe(patcher);
        expect(JSON.parse(readAsarFile(file, "package.json") ?? "{}")).toEqual({ name: "discord", main: "index.js" });
    });
});

describe("readAsarFile", () => {
    it("returns null for files that are not asar archives", () => {
        const file = join(tempDir(), "plain.asar");
        writeFileSync(file, "definitely not an asar archive");
        expect(readAsarFile(file, "index.js")).toBeNull();
    });

    it("returns null for missing entries and missing files", () => {
        const file = join(tempDir(), "app.asar");
        writePatchAsar(file, "/patcher.js");
        expect(readAsarFile(file, "missing.js")).toBeNull();
        expect(readAsarFile(join(tempDir(), "nope.asar"), "index.js")).toBeNull();
    });
});

describe("parseRequirePath", () => {
    it("extracts the required path", () => {
        expect(parseRequirePath('require("/a/b/patcher.js")')).toBe("/a/b/patcher.js");
    });

    it("returns null for unrelated sources", () => {
        expect(parseRequirePath("module.exports = 42")).toBeNull();
    });
});
