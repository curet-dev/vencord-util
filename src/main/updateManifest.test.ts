import { describe, expect, it } from "vitest";
import { evaluateUpdate, type ManifestFile, parseManifest, pickFile } from "./updateManifest";

const file = (name: string, platform: string, arch: string, type: ManifestFile["type"]): ManifestFile => ({
    name,
    platform,
    arch,
    type,
    size: 10,
    sha512: "x"
});

const FILES = [
    file("VencordUtil-0.2.0-win-x64-setup.exe", "win32", "x64", "setup"),
    file("VencordUtil-0.2.0-win-arm64-setup.exe", "win32", "arm64", "setup"),
    file("VencordUtil-0.2.0-win-x64-portable.exe", "win32", "x64", "portable"),
    file("VencordUtil-0.2.0-mac-arm64.dmg", "darwin", "arm64", "dmg")
];

describe("parseManifest", () => {
    it("keeps valid files and drops unsafe ones", () => {
        const manifest = parseManifest({
            version: "0.2.0",
            minimumVersion: "garbage",
            url: "https://evil.example/release",
            files: [...FILES, { ...FILES[0], name: "../evil.exe" }, { name: "x.exe" }]
        });
        expect(manifest.files).toEqual(FILES);
        expect(manifest.minimumVersion).toBeUndefined();
        expect(manifest.url).toBeUndefined();
    });

    it("rejects manifests without a version", () => {
        expect(() => parseManifest({ files: [] })).toThrow();
        expect(() => parseManifest(null)).toThrow();
    });
});

describe("pickFile", () => {
    it("matches platform, packaging and architecture", () => {
        expect(pickFile(FILES, "setup", "win32", "arm64")?.name).toBe("VencordUtil-0.2.0-win-arm64-setup.exe");
        expect(pickFile(FILES, "portable", "win32", "arm64")?.name).toBe("VencordUtil-0.2.0-win-x64-portable.exe");
        expect(pickFile(FILES, "dmg", "darwin", "x64")).toBeUndefined();
        expect(pickFile([...FILES, file("VencordUtil-0.2.0-mac-universal.dmg", "darwin", "universal", "dmg")], "dmg", "darwin", "x64")?.arch).toBe("universal");
    });
});

describe("evaluateUpdate", () => {
    const manifest = { version: "0.3.0", minimumVersion: "0.2.0", files: FILES };

    it("ignores versions that are not newer", () => {
        expect(evaluateUpdate(manifest, "0.3.0", "setup", "win32", "x64")).toBeNull();
        expect(evaluateUpdate(manifest, "0.4.0-beta.1", "setup", "win32", "x64")).toBeNull();
    });

    it("marks updates below the minimum version as mandatory", () => {
        expect(evaluateUpdate(manifest, "0.1.0", "setup", "win32", "x64")?.info).toMatchObject({ version: "0.3.0", mandatory: true, install: "setup" });
        expect(evaluateUpdate(manifest, "0.2.0", "setup", "win32", "x64")?.info.mandatory).toBe(false);
    });

    it("falls back to the release page when no file fits", () => {
        const result = evaluateUpdate(manifest, "0.1.0", "dmg", "darwin", "x64");
        expect(result?.info.install).toBe("manual");
        expect(result?.file).toBeUndefined();
        expect(evaluateUpdate(manifest, "0.1.0", "manual", "linux", "x64")?.info.pageUrl).toContain("github.com/curet-dev/vencord-util");
    });
});
