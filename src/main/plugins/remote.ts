import { net } from "electron";
import { UserError } from "../core/errors";
import type { GithubRepo } from "./source";

const USER_AGENT = "VencordUtil (+https://github.com/curet-dev/vencord-util)";
const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024;

interface GithubTreeResponse {
    truncated: boolean;
    tree: { path: string; sha: string }[];
}

export async function download(url: string): Promise<Buffer> {
    const response = await net.fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new UserError(`Download failed (${response.status} ${response.statusText}): ${url}`);
    if (Number(response.headers.get("content-length") ?? 0) > MAX_DOWNLOAD_BYTES) throw new UserError("The file is too large.");
    const data = Buffer.from(await response.arrayBuffer());
    if (data.byteLength > MAX_DOWNLOAD_BYTES) throw new UserError("The file is too large.");
    return data;
}

function githubHeaders() {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    return headers;
}

export async function fetchGithubTree({ owner, repo }: GithubRepo, ref: string): Promise<Map<string, string>> {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    const response = await net.fetch(url, { headers: githubHeaders() });
    if (response.status === 403 || response.status === 429) throw new UserError("GitHub rate limit reached – try again later.");
    if (response.status === 404) throw new UserError(`${owner}/${repo}@${ref} was not found on GitHub.`);
    if (!response.ok) throw new UserError(`GitHub request failed (${response.status}).`);
    const body = (await response.json()) as GithubTreeResponse;
    return new Map(body.tree.map(entry => [entry.path, entry.sha]));
}
