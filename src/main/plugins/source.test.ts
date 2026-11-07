import { describe, expect, it } from "vitest";
import { parseGithubRawUrl, parseGithubRepo, parsePluginUrl, sanitizeName } from "./source";

describe("parsePluginUrl", () => {
    it.each([
        ["owner/repo", { kind: "repo", cloneUrl: "https://github.com/owner/repo.git", name: "repo" }],
        ["github.com/owner/repo", { kind: "repo", cloneUrl: "https://github.com/owner/repo.git" }],
        ["https://github.com/owner/repo.git", { kind: "repo", cloneUrl: "https://github.com/owner/repo.git" }],
        ["https://github.com/owner/repo/tree/main/plugins/cool", { kind: "repo", treePath: ["main", "plugins", "cool"] }],
        ["https://github.com/owner/repo/blob/main/myPlugin/index.tsx", { kind: "repo", treePath: ["main", "myPlugin"] }],
        ["https://github.com/owner/repo/blob/main/single.tsx", { kind: "file", url: "https://raw.githubusercontent.com/owner/repo/main/single.tsx" }],
        ["https://raw.githubusercontent.com/owner/repo/main/x.ts", { kind: "file", fileName: "x.ts" }],
        ["https://github.com/owner/repo/archive/refs/heads/main.zip", { kind: "zip", name: "repo" }],
        ["https://gist.github.com/user/abcdef1234567890", { kind: "repo", cloneUrl: "https://gist.github.com/abcdef1234567890.git" }],
        ["https://codeberg.org/owner/plugin", { kind: "repo", cloneUrl: "https://codeberg.org/owner/plugin", name: "plugin" }]
    ])("parses %s", (input, expected) => {
        expect(parsePluginUrl(input)).toMatchObject(expected);
    });

    it("rejects invalid input", () => {
        expect(() => parsePluginUrl("not a link")).toThrow(/not a valid link/);
        expect(() => parsePluginUrl("ftp://example.com/plugin")).toThrow(/http/);
        expect(() => parsePluginUrl("https://github.com/owner/repo/blob/main/readme.md")).toThrow(/\.ts/);
    });
});

describe("sanitizeName", () => {
    it.each([
        ["my plugin!", "my-plugin"],
        [".hidden", "hidden"],
        ["_private", "private"],
        ["repo.git", "repo"],
        ["", "plugin"]
    ])("turns %j into %j", (input, expected) => {
        expect(sanitizeName(input)).toBe(expected);
    });
});

describe("GitHub URL helpers", () => {
    it("parses repository URLs", () => {
        expect(parseGithubRepo("https://github.com/owner/repo.git")).toEqual({ owner: "owner", repo: "repo" });
        expect(parseGithubRepo("https://codeberg.org/owner/repo")).toBeNull();
    });

    it("parses raw file URLs including refs/heads prefixes", () => {
        expect(parseGithubRawUrl("https://raw.githubusercontent.com/o/r/main/src/a.tsx")).toEqual({ owner: "o", repo: "r", ref: "main", path: "src/a.tsx" });
        expect(parseGithubRawUrl("https://raw.githubusercontent.com/o/r/refs/heads/dev/a.tsx")).toEqual({ owner: "o", repo: "r", ref: "dev", path: "a.tsx" });
        expect(parseGithubRawUrl("https://example.com/a.tsx")).toBeNull();
    });
});
