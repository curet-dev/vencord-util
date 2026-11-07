import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";

const created: string[] = [];

afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = "vu-test-") {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    created.push(dir);
    return dir;
}

export function writeTree(root: string, files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
        const target = join(root, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
    }
    return root;
}

export const pluginSource = (name: string, description = "") =>
    `import definePlugin from "@utils/types";\nexport default definePlugin({ name: "${name}", description: "${description}", authors: [Devs.Ven] });\n`;
