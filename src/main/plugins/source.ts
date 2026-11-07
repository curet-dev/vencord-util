import { basename } from "node:path";
import { UserError } from "../core/errors";

export const PLUGIN_INDEX_FILES = ["index.tsx", "index.ts", "index.jsx", "index.js"];
export const CODE_FILE = /\.(tsx?|jsx?)$/i;

export type PluginLink =
    | { kind: "repo"; cloneUrl: string; name: string; webUrl: string; treePath?: string[] }
    | { kind: "file"; url: string; fileName: string; parentName: string; webUrl: string }
    | { kind: "zip"; url: string; name: string; webUrl: string };

export interface GithubRepo {
    owner: string;
    repo: string;
}

export interface GithubFile extends GithubRepo {
    ref: string;
    path: string;
}

export const isIndexFile = (name: string) => PLUGIN_INDEX_FILES.includes(name.toLowerCase());

export function sanitizeName(raw: string) {
    const cleaned = raw
        .replace(/\.(git|zip)$/i, "")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^[._-]+/, "")
        .replace(/-+$/, "")
        .slice(0, 64);
    return cleaned || "plugin";
}

function normalizeInput(input: string) {
    const value = input.trim().replace(/^<|>$/g, "");
    if (/^[\w.-]+\/[\w.-]+$/.test(value)) return `https://github.com/${value}`;
    if (/^(www\.)?github\.com\//i.test(value)) return `https://${value}`;
    return value;
}

function parseGithubLink(parts: string[], url: URL): PluginLink {
    if (parts.length < 2) throw new UserError("The link must point to a GitHub repository.");
    const [owner, rawRepo, section, ...rest] = parts;
    const repo = rawRepo.replace(/\.git$/i, "");
    const cloneUrl = `https://github.com/${owner}/${repo}.git`;
    const repoUrl = `https://github.com/${owner}/${repo}`;
    const last = parts.at(-1) ?? "";

    if (section === "archive" && /\.zip$/i.test(last)) return { kind: "zip", url: url.href, name: sanitizeName(repo), webUrl: repoUrl };
    if (section === "tree" && rest.length) return { kind: "repo", cloneUrl, name: sanitizeName(repo), webUrl: url.href, treePath: rest };
    if ((section === "blob" || section === "raw") && rest.length >= 2) {
        if (isIndexFile(last)) return { kind: "repo", cloneUrl, name: sanitizeName(repo), webUrl: url.href, treePath: rest.slice(0, -1) };
        if (!CODE_FILE.test(last)) throw new UserError("The link does not point to a .ts/.tsx/.js file.");
        return {
            kind: "file",
            url: `https://raw.githubusercontent.com/${owner}/${repo}/${rest.join("/")}`,
            fileName: last,
            parentName: parts.at(-2) ?? repo,
            webUrl: url.href
        };
    }
    return { kind: "repo", cloneUrl, name: sanitizeName(repo), webUrl: repoUrl };
}

export function parsePluginUrl(input: string): PluginLink {
    const value = normalizeInput(input);
    if (value.startsWith("git@")) {
        return { kind: "repo", cloneUrl: value, name: sanitizeName(basename(value.split(":").pop() ?? "plugin")), webUrl: value };
    }

    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new UserError("That is not a valid link.", "Example: https://github.com/user/my-plugin");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new UserError("Only http(s) links are supported.");

    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const host = url.hostname.toLowerCase();
    const last = parts.at(-1) ?? "";

    if (host === "github.com" || host === "www.github.com") return parseGithubLink(parts, url);
    if (host === "gist.github.com") {
        const id = last.replace(/\.git$/, "");
        if (!id) throw new UserError("Invalid gist link.");
        return { kind: "repo", cloneUrl: `https://gist.github.com/${id}.git`, name: sanitizeName(`gist-${id.slice(0, 8)}`), webUrl: url.href };
    }
    if (CODE_FILE.test(last)) return { kind: "file", url: url.href, fileName: last, parentName: parts.at(-2) ?? "plugin", webUrl: url.href };
    if (/\.zip$/i.test(last)) return { kind: "zip", url: url.href, name: sanitizeName(last.replace(/\.zip$/i, "")), webUrl: url.href };
    return { kind: "repo", cloneUrl: url.href, name: sanitizeName(last || host), webUrl: url.href };
}

export function parseGithubRepo(url: string | undefined): GithubRepo | null {
    const match = url?.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i);
    return match ? { owner: match[1], repo: match[2] } : null;
}

export function parseGithubRawUrl(url: string | undefined): GithubFile | null {
    const match = url?.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(.+)$/i);
    if (!match) return null;
    const [, owner, repo, rest] = match;
    const segments = rest.split("/").map(decodeURIComponent);
    const refSegments = segments[0] === "refs" ? 3 : 1;
    if (segments.length <= refSegments) return null;
    const ref = segments
        .slice(0, refSegments)
        .join("/")
        .replace(/^refs\/(heads|tags)\//, "");
    return { owner, repo, ref, path: segments.slice(refSegments).join("/") };
}
