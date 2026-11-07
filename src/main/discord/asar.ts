import rawFs from "original-fs";

const PACKAGE_JSON = `{
\t"name": "discord",
\t"main": "index.js"
}`;

const HEADER_PREFIX_BYTES = 16;
const ALIGNMENT = 4;
const MAX_READABLE_ARCHIVE_BYTES = 8 * 1024 * 1024;

interface AsarEntry {
    size: number;
    offset: string;
}

export function buildPatchAsar(patcherPath: string): Buffer {
    const indexJs = `require(${JSON.stringify(patcherPath)})`;
    const indexJsBytes = Buffer.byteLength(indexJs);

    const header = JSON.stringify({
        files: {
            "index.js": { size: indexJsBytes, offset: "0" },
            "package.json": { size: Buffer.byteLength(PACKAGE_JSON), offset: String(indexJsBytes) }
        }
    });
    const headerBytes = Buffer.byteLength(header);
    const alignedBytes = Math.ceil(headerBytes / ALIGNMENT) * ALIGNMENT;

    const prefix = Buffer.alloc(HEADER_PREFIX_BYTES);
    prefix.writeInt32LE(ALIGNMENT, 0);
    prefix.writeInt32LE(alignedBytes + 8, 4);
    prefix.writeInt32LE(alignedBytes + ALIGNMENT, 8);
    prefix.writeInt32LE(headerBytes, 12);

    return Buffer.concat([prefix, Buffer.from(header + "0".repeat(alignedBytes - headerBytes)), Buffer.from(indexJs + PACKAGE_JSON)]);
}

export function writePatchAsar(file: string, patcherPath: string) {
    rawFs.writeFileSync(file, buildPatchAsar(patcherPath));
}

export function readAsarFile(archive: string, name: string): string | null {
    let fd: number | null = null;
    try {
        const { size } = rawFs.statSync(archive);
        if (size < HEADER_PREFIX_BYTES || size > MAX_READABLE_ARCHIVE_BYTES) return null;

        fd = rawFs.openSync(archive, "r");
        const prefix = Buffer.alloc(HEADER_PREFIX_BYTES);
        rawFs.readSync(fd, prefix, 0, HEADER_PREFIX_BYTES, 0);
        const headerSize = prefix.readUInt32LE(4);
        const headerBytes = prefix.readUInt32LE(12);
        if (headerBytes === 0 || headerBytes > size) return null;

        const headerBuffer = Buffer.alloc(headerBytes);
        rawFs.readSync(fd, headerBuffer, 0, headerBytes, HEADER_PREFIX_BYTES);
        const entry: AsarEntry | undefined = JSON.parse(headerBuffer.toString("utf8")).files?.[name];
        if (!entry || typeof entry.size !== "number") return null;

        const content = Buffer.alloc(entry.size);
        rawFs.readSync(fd, content, 0, entry.size, 8 + headerSize + Number(entry.offset));
        return content.toString("utf8");
    } catch {
        return null;
    } finally {
        if (fd !== null) rawFs.closeSync(fd);
    }
}

export function parseRequirePath(source: string): string | null {
    const literal = source.match(/require\(\s*("(?:[^"\\]|\\.)*")\s*\)/)?.[1];
    if (!literal) return null;
    try {
        return JSON.parse(literal);
    } catch {
        return null;
    }
}
