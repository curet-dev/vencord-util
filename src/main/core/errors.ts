export class UserError extends Error {
    constructor(
        message: string,
        readonly hint?: string
    ) {
        super(message);
        this.name = "UserError";
    }
}

const HINTS = {
    busy: "A file is still in use. Fully close Discord (including the system tray) and try again.",
    macPermission:
        "macOS blocked access. Allow Vencord Util under System Settings → Privacy & Security → App Management (or Full Disk Access) and restart the app.",
    permission: "Access denied. Close Discord and try again – if needed, run the app as administrator.",
    network: "Network error – check your internet connection.",
    dependencies: "Dependencies are missing or outdated. Run “Install dependencies” again.",
    localChanges: "The Vencord folder has local changes. Use “Stash local changes & update”.",
    repository: "The repository does not exist or is private. Check the link."
};

export function hintFor(error: unknown): string | undefined {
    if (error instanceof UserError) return error.hint;

    const { message = "", output = "", code } = (error ?? {}) as { message?: string; output?: string; code?: string };
    const text = `${message}\n${output}`;

    if (/EBUSY|resource busy|being used by another process|ERROR_SHARING_VIOLATION/i.test(text)) return HINTS.busy;
    if (code === "EPERM" || code === "EACCES" || /operation not permitted|permission denied/i.test(text)) {
        return process.platform === "darwin" ? HINTS.macPermission : HINTS.permission;
    }
    if (/could not resolve host|unable to access|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed/i.test(text)) return HINTS.network;
    if (/Cannot find package|ERR_MODULE_NOT_FOUND/i.test(text)) return HINTS.dependencies;
    if (/Your local changes|would be overwritten|not possible to fast-forward|diverging/i.test(text)) return HINTS.localChanges;
    if (/Repository not found|could not read Username|Authentication failed/i.test(text)) return HINTS.repository;
    return undefined;
}
