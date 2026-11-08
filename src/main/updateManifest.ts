import type { AppUpdateInfo, AppUpdateInstallKind } from "@shared/types";
import { compareVersions, isValidVersion } from "@shared/version";

export const RELEASE_REPO = "curet-dev/vencord-util";
export const RELEASES_URL = `https://github.com/${RELEASE_REPO}/releases/latest`;

/** One file of a release as listed in update.json (written by scripts/release-manifest.mjs). */
export interface ManifestFile {
    name: string;
    platform: string;
    arch: string;
    type: Exclude<AppUpdateInstallKind, "manual">;
    size: number;
    sha512: string;
}

export interface UpdateManifest {
    version: string;
    minimumVersion?: string;
    releaseDate?: string;
    notes?: string;
    url?: string;
    files: ManifestFile[];
}

export function parseManifest(value: unknown): UpdateManifest {
    const data = value as Partial<UpdateManifest> | null;
    if (!data || !isValidVersion(data.version)) throw new Error("The update information is invalid.");
    const files = (Array.isArray(data.files) ? data.files : []).filter(
        (file): file is ManifestFile =>
            typeof file?.name === "string" &&
            /^[\w.-]+$/.test(file.name) &&
            typeof file.platform === "string" &&
            typeof file.arch === "string" &&
            ["setup", "portable", "dmg"].includes(file.type) &&
            Number.isFinite(file.size) &&
            typeof file.sha512 === "string"
    );
    return {
        version: data.version,
        minimumVersion: isValidVersion(data.minimumVersion) ? data.minimumVersion : undefined,
        releaseDate: typeof data.releaseDate === "string" ? data.releaseDate : undefined,
        notes: typeof data.notes === "string" ? data.notes : undefined,
        url: typeof data.url === "string" && data.url.startsWith(`https://github.com/${RELEASE_REPO}/`) ? data.url : undefined,
        files
    };
}

/** Picks the release file that replaces the running app: same platform, packaging and architecture. */
export function pickFile(files: ManifestFile[], kind: AppUpdateInstallKind, platform: string, arch: string) {
    const matching = files.filter(file => file.platform === platform && file.type === kind);
    return matching.find(file => file.arch === arch) ?? matching.find(file => file.arch === "universal") ?? (kind === "portable" ? matching[0] : undefined);
}

export function evaluateUpdate(manifest: UpdateManifest, current: string, kind: AppUpdateInstallKind, platform: string, arch: string) {
    if (compareVersions(manifest.version, current) <= 0) return null;
    const file = kind === "manual" ? undefined : pickFile(manifest.files, kind, platform, arch);
    const info: AppUpdateInfo = {
        current,
        version: manifest.version,
        minimumVersion: manifest.minimumVersion,
        mandatory: Boolean(manifest.minimumVersion && compareVersions(current, manifest.minimumVersion) < 0),
        notes: manifest.notes,
        releaseDate: manifest.releaseDate,
        pageUrl: manifest.url ?? RELEASES_URL,
        install: file ? kind : "manual",
        size: file?.size
    };
    return { info, file };
}
