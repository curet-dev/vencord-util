import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pluginSource, tempDir, writeTree } from "../test/fixtures";
import { matchCandidate } from "./link";
import { folderNameFor, pluginFolderName } from "./staging";

describe("matchCandidate", () => {
    const repo = () =>
        writeTree(tempDir(), {
            "plugins/haunt/index.tsx": pluginSource("Haunt"),
            "plugins/other/index.tsx": pluginSource("Other"),
            "single.tsx": pluginSource("Single")
        });
    const candidates = (root: string) => [
        { path: join(root, "plugins", "haunt"), kind: "folder" as const },
        { path: join(root, "plugins", "other"), kind: "folder" as const },
        { path: join(root, "single.tsx"), kind: "file" as const }
    ];

    it("matches by plugin name, then by folder name", () => {
        const root = repo();
        expect(matchCandidate(candidates(root), { id: "src", kind: "folder", name: "Haunt" }).path).toBe(join(root, "plugins", "haunt"));
        expect(matchCandidate(candidates(root), { id: "other", kind: "folder" }).path).toBe(join(root, "plugins", "other"));
        expect(matchCandidate(candidates(root), { id: "x.tsx", kind: "file" }).path).toBe(join(root, "single.tsx"));
    });

    it("refuses ambiguous or mismatching links", () => {
        const root = repo();
        expect(() => matchCandidate(candidates(root), { id: "unknown", kind: "folder", name: "Unknown" })).toThrow(/none of them clearly matches/);
        expect(() => matchCandidate([candidates(root)[0]], { id: "x", kind: "folder", name: "Other" })).toThrow(/called “Haunt”/);
        expect(() => matchCandidate([candidates(root)[2]], { id: "x", kind: "folder" })).toThrow(/single-file plugin/);
        expect(() => matchCandidate([], { id: "x", kind: "folder" })).toThrow(/No Vencord plugin/);
    });
});

describe("plugin folder names", () => {
    it("replaces generic folder names with the plugin name", () => {
        expect(folderNameFor("Cool Plugin")).toBe("coolPlugin");
        expect(pluginFolderName("src", "Haunt", "vencord-plugin")).toBe("haunt");
        expect(pluginFolderName("src", undefined, "vencord-plugin")).toBe("vencord-plugin");
        expect(pluginFolderName("betterFolders", "Better Folders", "x")).toBe("betterFolders");
    });
});
