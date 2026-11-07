import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { tempDir, writeTree } from "../test/fixtures";
import { extractZip, gitBlobSha, hashTree, removePath } from "./fsutil";

describe("gitBlobSha", () => {
    it("matches git hash-object", () => {
        expect(gitBlobSha(new Uint8Array())).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
        expect(gitBlobSha(strToU8("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    });
});

describe("extractZip", () => {
    it("unwraps the single top-level folder of GitHub archives", () => {
        const zip = zipSync({ "repo-main/": new Uint8Array(), "repo-main/plugin/index.ts": strToU8("x") });
        const root = extractZip(zip, join(tempDir(), "out"));
        expect(root.endsWith("repo-main")).toBe(true);
        expect(readFileSync(join(root, "plugin", "index.ts"), "utf8")).toBe("x");
    });

    it("blocks path traversal (zip slip)", () => {
        const base = tempDir();
        const zip = zipSync({ "../../evil.ts": strToU8("x") });
        expect(() => extractZip(zip, join(base, "out"))).toThrow(/unsafe/);
        expect(existsSync(join(base, "..", "evil.ts"))).toBe(false);
    });
});

describe("hashTree", () => {
    it("ignores .git and node_modules but detects content changes", () => {
        const a = writeTree(tempDir(), { "index.ts": "a", ".git/HEAD": "1", "node_modules/x.js": "1" });
        const b = writeTree(tempDir(), { "index.ts": "a", ".git/HEAD": "2" });
        const c = writeTree(tempDir(), { "index.ts": "changed" });
        expect(hashTree(a)).toBe(hashTree(b));
        expect(hashTree(a)).not.toBe(hashTree(c));
    });
});

describe("removePath", () => {
    it("removes nested folders", () => {
        const root = writeTree(tempDir(), { "a/b/c.txt": "x" });
        removePath(join(root, "a"));
        expect(existsSync(join(root, "a"))).toBe(false);
    });
});
