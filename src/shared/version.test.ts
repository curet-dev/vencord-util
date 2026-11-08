import { describe, expect, it } from "vitest";
import { compareVersions, isValidVersion } from "./version";

describe("compareVersions", () => {
    it("orders release versions numerically", () => {
        expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
        expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
        expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
        expect(compareVersions("v1.2.3", "1.2.4")).toBe(-1);
    });

    it("sorts prereleases before the release", () => {
        expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
        expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
        expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
        expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
        expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    });

    it("ignores build metadata and treats invalid versions as lowest", () => {
        expect(compareVersions("1.0.0+build.5", "1.0.0")).toBe(0);
        expect(compareVersions("nonsense", "0.0.1")).toBe(-1);
        expect(isValidVersion("1.2")).toBe(false);
        expect(isValidVersion("1.2.3-beta")).toBe(true);
    });
});
