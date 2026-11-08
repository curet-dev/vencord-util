// Writes update.json for the in-app updater: version, minimum supported version, release notes and the SHA-512 of every installer.
// Usage: node scripts/release-manifest.mjs <directory with release files> [release notes file]
//        node scripts/release-manifest.mjs --check   (only validates version and minimumVersion in package.json)
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "curet-dev/vencord-util";
const FILE_PATTERN = /^VencordUtil-(.+)-(win|mac)-(x64|arm64|universal)(?:-(setup|portable))?\.(exe|dmg)$/;
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

const [directory, notesFile] = process.argv.slice(2);
if (!directory) {
    console.error("Usage: node scripts/release-manifest.mjs <directory> [release-notes.md]");
    process.exit(1);
}

const fail = message => {
    console.error(`::error::${message}`);
    process.exit(1);
};

function compareCore(a, b) {
    const left = a.match(VERSION_PATTERN).slice(1, 4).map(Number);
    const right = b.match(VERSION_PATTERN).slice(1, 4).map(Number);
    for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
    return 0;
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const { version, minimumVersion } = pkg;
if (!VERSION_PATTERN.test(version)) fail(`package.json has an invalid version: ${version}`);
if (minimumVersion !== undefined) {
    if (!VERSION_PATTERN.test(minimumVersion)) fail(`package.json has an invalid minimumVersion: ${minimumVersion}`);
    if (compareCore(minimumVersion, version) > 0) fail(`minimumVersion ${minimumVersion} is newer than version ${version}`);
}
if (directory === "--check") {
    console.warn(`version ${version}, minimumVersion ${minimumVersion ?? "(none)"} – OK`);
    process.exit(0);
}

const files = [];
for (const name of readdirSync(directory).sort()) {
    const match = name.match(FILE_PATTERN);
    if (!match) continue;
    const [, fileVersion, os, arch, kind, extension] = match;
    if (fileVersion !== version) fail(`${name} does not belong to version ${version}`);
    const data = readFileSync(join(directory, name));
    files.push({
        name,
        platform: os === "win" ? "win32" : "darwin",
        arch,
        type: extension === "dmg" ? "dmg" : (kind ?? "setup"),
        size: statSync(join(directory, name)).size,
        sha512: createHash("sha512").update(data).digest("base64")
    });
}
if (!files.length) fail(`No release files found in ${directory}`);

const manifest = {
    version,
    ...(minimumVersion ? { minimumVersion } : {}),
    releaseDate: new Date().toISOString(),
    notes: notesFile ? readFileSync(notesFile, "utf8").trim() : undefined,
    url: `https://github.com/${REPO}/releases/tag/v${version}`,
    files
};
writeFileSync(join(directory, "update.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.warn(`update.json: ${version}${minimumVersion ? ` (minimum ${minimumVersion})` : ""}, ${files.length} files`);
