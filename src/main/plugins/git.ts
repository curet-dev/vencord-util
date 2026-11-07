import { UserError } from "../core/errors";
import { gitOutput } from "../core/exec";
import { which } from "../core/path";
import type { TaskContext } from "../core/tasks";

export interface ResolvedTreePath {
    ref: string;
    subdir: string;
    isCommit: boolean;
}

export interface RepoSnapshot {
    commit: string;
    ref: string;
    objects: Map<string, string>;
}

function assertGit() {
    if (!which("git")) throw new UserError("Git was not found.", "Install Git on the “Install” page.");
}

export async function resolveTreePath(cloneUrl: string, treePath: string[], ctx: TaskContext): Promise<ResolvedTreePath> {
    assertGit();
    const { stdout } = await ctx.exec("git", ["ls-remote", "--heads", "--tags", cloneUrl], { quiet: true, timeoutMs: 60_000 });
    const refs = new Set(
        stdout
            .split("\n")
            .map(line => line.split("\t")[1]?.trim())
            .filter((ref): ref is string => Boolean(ref))
            .map(ref => ref.replace(/^refs\/(heads|tags)\//, "").replace(/\^\{\}$/, ""))
    );
    for (let length = treePath.length; length >= 1; length--) {
        const ref = treePath.slice(0, length).join("/");
        if (refs.has(ref)) return { ref, subdir: treePath.slice(length).join("/"), isCommit: false };
    }
    return { ref: treePath[0], subdir: treePath.slice(1).join("/"), isCommit: true };
}

export async function cloneRepository(destination: string, cloneUrl: string, ref: string | undefined, isCommit: boolean, ctx: TaskContext) {
    assertGit();
    if (isCommit && ref) {
        await ctx.exec("git", ["clone", "--filter=blob:none", "--no-checkout", cloneUrl, destination], { collapseProgress: true });
        await ctx.exec("git", ["checkout", ref], { cwd: destination });
        return;
    }
    const refArgs = ref ? ["--branch", ref] : [];
    await ctx.exec("git", ["clone", "--depth", "1", ...refArgs, cloneUrl, destination], { collapseProgress: true });
}

export async function readSnapshot(repoDir: string): Promise<RepoSnapshot> {
    const [commit, ref, tree] = await Promise.all([
        gitOutput(["rev-parse", "HEAD"], repoDir),
        gitOutput(["rev-parse", "--abbrev-ref", "HEAD"], repoDir),
        gitOutput(["ls-tree", "-r", "-t", "-z", "HEAD"], repoDir, 30_000)
    ]);
    const objects = new Map<string, string>();
    for (const record of (tree ?? "").split("\0")) {
        const [meta, path] = record.split("\t");
        const sha = meta?.split(" ")[2];
        if (path && sha) objects.set(path, sha);
    }
    return { commit: commit ?? "", ref: ref && ref !== "HEAD" ? ref : "", objects };
}

export async function remoteHead(url: string, ref: string | undefined, cwd: string) {
    const output = await gitOutput(["ls-remote", url, ref ? `refs/heads/${ref}` : "HEAD"], cwd, 30_000);
    return output?.split(/\s+/)[0] || undefined;
}
