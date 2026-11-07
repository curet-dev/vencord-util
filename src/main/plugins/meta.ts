export interface PluginMeta {
    isPlugin: boolean;
    name?: string;
    description?: string;
    authors: string[];
}

function readStringField(source: string, field: string) {
    const pattern = new RegExp(`\\b${field}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`);
    const value = source.match(pattern)?.[2];
    return value?.replace(/\\(["'`\\])/g, "$1").replace(/\\n/g, " ");
}

function readAuthors(source: string) {
    const block = source.match(/authors\s*:\s*\[([\s\S]*?)\]/)?.[1];
    if (!block) return [];
    return [...block.matchAll(/(?:Equicord)?Devs\.(\w+)|name\s*:\s*["'`]([^"'`]+)["'`]/g)].map(match => match[1] ?? match[2]);
}

export function parsePluginMeta(source: string): PluginMeta {
    const start = source.search(/definePlugin\s*\(/);
    if (start < 0) return { isPlugin: false, authors: [] };
    const body = source.slice(start);
    return {
        isPlugin: true,
        name: readStringField(body, "name"),
        description: readStringField(body, "description"),
        authors: readAuthors(body)
    };
}
