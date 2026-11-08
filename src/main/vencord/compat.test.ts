import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir, writeTree } from "../test/fixtures";
import { aliasTarget, analyzeCompat, scanExports, scanImports } from "./compat";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

function commitAll(cwd: string, message: string) {
    git(cwd, "add", "-A");
    git(cwd, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", message);
    return git(cwd, "rev-parse", "HEAD");
}

describe("aliasTarget", () => {
    it("maps Vencord path aliases", () => {
        expect(aliasTarget("@webpack/common")).toBe("src/webpack/common");
        expect(aliasTarget("@webpack")).toBe("src/webpack/webpack");
        expect(aliasTarget("@components/Heading")).toBe("src/components/Heading");
        expect(aliasTarget("@utils/types")).toBe("src/utils/types");
        expect(aliasTarget("@vencord/discord-types")).toBeNull();
        expect(aliasTarget("./local")).toBeNull();
    });
});

describe("scanExports", () => {
    it("finds declarations, destructuring, lists and re-exports", () => {
        const scanned = scanExports(`
export let Toasts: t.Toasts;
export const showToast = find();
export const { match, P }: { match: any; P: any } = lazy();
export async function load() {}
export default function plugin() {}
export interface Options {}
export type Size = "sm";
export { a, b as c, type D };
export * as ns from "./ns";
export * from "./components";
 * export const Commented = 1;
`);
        expect([...scanned.values].sort()).toEqual(["P", "Toasts", "a", "c", "default", "load", "match", "ns", "plugin", "showToast"].sort());
        expect([...scanned.types].sort()).toEqual(["D", "Options", "Size"]);
        expect(scanned.stars).toEqual(["./components"]);
    });
});

describe("scanImports", () => {
    it("collects value imports from Vencord aliases only", () => {
        const imports = scanImports(
            `import definePlugin, { OptionType } from "@utils/types";
import type { Channel } from "@vencord/discord-types";
import type { Foo } from "@webpack/common";
import {
    showToast,
    Toasts as T,
    type Bar
} from "@webpack/common";
import { helper } from "./utils";
import * as Common from "@webpack/common";
`,
            "index.tsx"
        );
        expect(imports).toEqual([
            { file: "index.tsx", line: 1, module: "@utils/types", names: ["OptionType", "default"] },
            { file: "index.tsx", line: 4, module: "@webpack/common", names: ["showToast", "Toasts"] },
            { file: "index.tsx", line: 10, module: "@webpack/common", names: [] }
        ]);
    });
});

describe("analyzeCompat", () => {
    it("reports imports that do not exist in the current version", async () => {
        const repo = tempDir();
        git(repo, "init", "-q");
        writeTree(repo, {
            // The unresolvable re-export makes the exports of @webpack/common incomplete, so "Toasts" must not be reported.
            "src/webpack/common/index.ts": 'export * from "./utils";\nexport * from "@vencord/discord-types";\n',
            "src/webpack/common/utils.ts": "export const showToast = () => {};\n",
            "src/utils/constants.ts": "export const Devs = {};\n",
            "src/components/Heading.tsx": "export function Heading() {}\n"
        });
        const head = commitAll(repo, "head");
        const plugin = writeTree(join(repo, "plugin"), {
            "index.tsx": [
                'import { Heading, HeadingSecondary } from "@components/Heading";',
                'import { Toasts } from "@webpack/common";',
                'import { x } from "@utils/missing";',
                'import { Devs } from "@utils/constants.js";'
            ].join("\n")
        });

        expect(await analyzeCompat(repo, [{ id: "plugin", path: plugin }], head)).toEqual([
            {
                id: "plugin",
                name: undefined,
                issues: [
                    { file: "index.tsx", line: 1, module: "@components/Heading", name: "HeadingSecondary" },
                    { file: "index.tsx", line: 3, module: "@utils/missing" }
                ]
            }
        ]);
    });

    it("reports imports that an update removes", async () => {
        const repo = tempDir();
        git(repo, "init", "-q");
        writeTree(repo, {
            "src/webpack/common/index.ts": 'export * from "./utils";\nexport * from "./components";\n',
            "src/webpack/common/utils.ts": "export let Toasts: any;\nexport const showToast = () => {};\n",
            "src/webpack/common/components.ts": "export let Forms: any;\n",
            "src/components/Heading.tsx": "export function Heading() {}\nexport function HeadingSecondary() {}\n",
            "src/components/Old.tsx": "export const Old = 1;\n"
        });
        const before = commitAll(repo, "before");
        writeTree(repo, {
            "src/webpack/common/utils.ts": "export const showToast = () => {};\n",
            "src/components/Heading.tsx": "export function Heading() {}\n"
        });
        git(repo, "rm", "-q", "src/components/Old.tsx");
        const after = commitAll(repo, "after");

        const plugins = join(repo, "src", "userplugins");
        writeTree(plugins, {
            "broken/index.tsx": 'import { showToast, Toasts, Forms } from "@webpack/common";\nimport { HeadingSecondary } from "@components/Heading";\n',
            "broken/settings.tsx": 'import { Old } from "@components/Old";\n',
            "fine/index.tsx": 'import { showToast, Forms } from "@webpack/common";\nimport { Heading } from "@components/Heading";\n',
            "single.tsx": 'import { Toasts } from "@webpack/common";\n'
        });

        const result = await analyzeCompat(
            repo,
            [
                { id: "broken", name: "Broken", path: join(plugins, "broken") },
                { id: "fine", path: join(plugins, "fine") },
                { id: "single.tsx", path: join(plugins, "single.tsx") }
            ],
            after,
            before
        );

        expect(result).toEqual([
            {
                id: "broken",
                name: "Broken",
                issues: [
                    { file: "index.tsx", line: 1, module: "@webpack/common", name: "Toasts" },
                    { file: "index.tsx", line: 2, module: "@components/Heading", name: "HeadingSecondary" },
                    { file: "settings.tsx", line: 1, module: "@components/Old" }
                ]
            },
            { id: "single.tsx", name: undefined, issues: [{ file: "single.tsx", line: 1, module: "@webpack/common", name: "Toasts" }] }
        ]);
    });
});
