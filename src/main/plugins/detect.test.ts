import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { pluginSource, tempDir, writeTree } from "../test/fixtures";
import { findPluginCandidates } from "./detect";

const names = (root: string) => findPluginCandidates(root).map(found => `${found.kind}:${basename(found.path)}`);

describe("findPluginCandidates", () => {
    it("treats a folder with an index file as a single plugin", () => {
        const root = writeTree(tempDir(), { "index.tsx": pluginSource("Root"), "utils.ts": "export const x = 1;" });
        expect(findPluginCandidates(root)).toEqual([{ path: root, kind: "folder" }]);
    });

    it("finds every plugin in a collection repository", () => {
        const root = writeTree(tempDir(), {
            "README.md": "# plugins",
            "alpha/index.ts": pluginSource("Alpha"),
            "beta.tsx": pluginSource("Beta"),
            "nested/src/gamma/index.tsx": pluginSource("Gamma"),
            "shared/index.ts": "export const helper = 1;",
            "types.d.ts": "declare const x: number;",
            "node_modules/dep/index.ts": pluginSource("Ignored")
        });
        expect(names(root).sort()).toEqual(["file:beta.tsx", "folder:alpha", "folder:gamma"]);
    });

    it("returns a single file as-is", () => {
        const root = writeTree(tempDir(), { "solo.tsx": pluginSource("Solo") });
        expect(findPluginCandidates(join(root, "solo.tsx"))).toEqual([{ path: join(root, "solo.tsx"), kind: "file" }]);
    });

    it("rejects complete Vencord forks", () => {
        const root = writeTree(tempDir(), {
            "package.json": JSON.stringify({ name: "vencord" }),
            "src/plugins/a/index.ts": pluginSource("A")
        });
        expect(() => findPluginCandidates(root)).toThrow(/fork/);
    });

    it("returns nothing for folders without plugins", () => {
        const root = writeTree(tempDir(), { "README.md": "nothing here", "lib/index.ts": "export {}" });
        expect(findPluginCandidates(root)).toEqual([]);
    });
});
