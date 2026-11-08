import { describe, expect, it } from "vitest";
import { PluginBuildError } from "../core/errors";
import { ExecError } from "../core/exec";
import { explainBuildFailure, parseBuildProblems } from "./buildErrors";

const OUTPUT = `$ node --require=./scripts/suppressExperimentalWarnings.js scripts/build/build.mjs
  dist\\patcher.js             38.0kb
Done in 145ms
X [ERROR] No matching export in "src/webpack/common/index.ts" for import "Toasts"

    src/userplugins/haunt/components/HauntSettings.tsx:10:20:
      10 │ import { showToast, Toasts, UserStore,useState } from "@webpack/co...
         ╵                     ~~~~~~
X [ERROR] No matching export in "src/components/Heading.tsx" for import "HeadingSecondary"

    src/userplugins/larping/BadgeSettings.tsx:9:9:
      9 │ import { HeadingSecondary } from "@components/Heading";
        ╵          ~~~~~~~~~~~~~~~~
6 errors
Build failed with 6 errors:
src/userplugins/haunt/components/HauntSettings.tsx:10:20: ERROR: No matching export in "src/webpack/common/index.ts" for import "Toasts"
src/userplugins/larping/SyncSettings.tsx:14:20: ERROR: No matching export in "src/webpack/common/index.ts" for import "Toasts"
src/userplugins/single.tsx:3:1: ERROR: Unexpected "}"
...
[ELIFECYCLE] Command failed with exit code 1.`;

describe("parseBuildProblems", () => {
    it("reads pretty and summary esbuild errors and removes duplicates", () => {
        expect(parseBuildProblems(OUTPUT)).toEqual([
            {
                plugin: "haunt",
                file: "components/HauntSettings.tsx",
                line: 10,
                message: 'No matching export in "src/webpack/common/index.ts" for import "Toasts"'
            },
            {
                plugin: "larping",
                file: "BadgeSettings.tsx",
                line: 9,
                message: 'No matching export in "src/components/Heading.tsx" for import "HeadingSecondary"'
            },
            { plugin: "larping", file: "SyncSettings.tsx", line: 14, message: 'No matching export in "src/webpack/common/index.ts" for import "Toasts"' },
            { plugin: "single.tsx", file: "single.tsx", line: 3, message: 'Unexpected "}"' }
        ]);
    });

    it("recognises invalid plugin folders", () => {
        expect(parseBuildProblems("Error: Invalid plugin src\\userplugins\\broken: could not resolve entry point")).toEqual([
            { plugin: "broken", file: "broken", line: undefined, message: "could not resolve entry point" }
        ]);
    });

    it("ignores errors outside of user plugins", () => {
        expect(parseBuildProblems('src/plugins/foo/index.ts:1:1: ERROR: Could not resolve "x"')).toEqual([]);
    });
});

describe("explainBuildFailure", () => {
    it("names the plugins that broke the build", () => {
        const error = explainBuildFailure(new ExecError('"pnpm build" failed with exit code 1', 1, "", true, OUTPUT), id => (id === "haunt" ? "Haunt" : id));
        expect(error).toBeInstanceOf(PluginBuildError);
        const buildError = error as PluginBuildError;
        expect(buildError.message).toBe("The build failed because of 3 plugins: Haunt, larping, single.tsx.");
        expect(buildError.brokenPlugins).toEqual(["haunt", "larping", "single.tsx"]);
        expect(buildError.hint).toContain("renamed or removed");
        expect(buildError.hint).toContain("larping: No matching export");
        expect(buildError.hint).toContain("– and 1 more");
    });

    it("keeps unrelated errors", () => {
        const error = new ExecError("failed", 1, "boom", true, "boom");
        expect(explainBuildFailure(error)).toBe(error);
        expect(explainBuildFailure(new Error("x"))).toBeInstanceOf(Error);
    });
});
