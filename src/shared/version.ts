const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

interface ParsedVersion {
    core: [number, number, number];
    pre: string[];
}

export function parseVersion(version: string): ParsedVersion | null {
    const match = version.trim().match(VERSION_PATTERN);
    if (!match) return null;
    return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4]?.split(".") ?? [] };
}

export const isValidVersion = (version: unknown): version is string => typeof version === "string" && parseVersion(version) !== null;

function comparePrerelease(a: string[], b: string[]) {
    if (!a.length || !b.length) return b.length - a.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] === undefined) return -1;
        if (b[i] === undefined) return 1;
        const numericA = /^\d+$/.test(a[i]);
        const numericB = /^\d+$/.test(b[i]);
        if (numericA && numericB) {
            const diff = Number(a[i]) - Number(b[i]);
            if (diff) return Math.sign(diff);
        } else if (numericA !== numericB) {
            return numericA ? -1 : 1;
        } else if (a[i] !== b[i]) {
            return a[i] < b[i] ? -1 : 1;
        }
    }
    return 0;
}

/** Compares two semantic versions: negative if a < b, 0 if equal, positive if a > b. Invalid versions sort first. */
export function compareVersions(a: string, b: string): number {
    const left = parseVersion(a);
    const right = parseVersion(b);
    if (!left || !right) return Number(Boolean(left)) - Number(Boolean(right));
    for (let i = 0; i < 3; i++) {
        const diff = left.core[i] - right.core[i];
        if (diff) return Math.sign(diff);
    }
    return Math.sign(comparePrerelease(left.pre, right.pre));
}
