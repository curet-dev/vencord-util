export type ToolName = "git" | "node" | "pnpm";

export interface ToolInfo {
    name: ToolName;
    found: boolean;
    ok: boolean;
    version?: string;
    path?: string;
    problem?: string;
}

export interface EnvStatus {
    platform: string;
    arch: string;
    tools: Record<ToolName, ToolInfo>;
    installer: "winget" | "brew" | null;
    requiredNodeMajor: number;
}

export interface AppInfo {
    version: string;
    platform: string;
    arch: string;
    packaged: boolean;
}

export type AppUpdateInstallKind = "setup" | "portable" | "dmg" | "manual";

export interface AppUpdateInfo {
    current: string;
    version: string;
    minimumVersion?: string;
    mandatory: boolean;
    notes?: string;
    releaseDate?: string;
    pageUrl: string;
    install: AppUpdateInstallKind;
    size?: number;
}

export type AppUpdatePhase = "idle" | "checking" | "current" | "available" | "downloading" | "installing" | "error";

export interface AppUpdateState {
    phase: AppUpdatePhase;
    info?: AppUpdateInfo;
    received?: number;
    total?: number;
    error?: string;
    checkedAt?: number;
}

export type DiscordBranch = "stable" | "ptb" | "canary" | "development";

export type PatchKind = "none" | "source" | "official" | "other" | "broken";

export interface PatchInfo {
    kind: PatchKind;
    patcherPath?: string;
    legacy?: boolean;
    sourceDir?: string;
}

export interface DiscordInstall {
    id: string;
    branch: DiscordBranch;
    name: string;
    path: string;
    resourcesPath: string;
    version?: string;
    patch: PatchInfo;
    running: boolean;
}

export interface VencordStatus {
    dir: string;
    exists: boolean;
    isRepo: boolean;
    isVencord: boolean;
    version?: string;
    commit?: string;
    commitMessage?: string;
    commitDate?: string;
    branch?: string;
    remote?: string;
    dirty: boolean;
    depsInstalled: boolean;
    built: boolean;
    builtAt?: number;
    userPluginsDir: string;
}

export interface UpdateCommit {
    hash: string;
    author: string;
    date: string;
    message: string;
}

export interface UpdateInfo {
    behind: number;
    ahead: number;
    commits: UpdateCommit[];
    checkedAt: number;
    error?: string;
}

export type PluginSourceType = "git" | "git-subdir" | "url-file" | "local";

export interface PluginSource {
    type: PluginSourceType;
    url?: string;
    ref?: string;
    subdir?: string;
    localPath?: string;
    revision?: string;
    commit?: string;
    installedAt: number;
    updatedAt?: number;
}

export interface PluginUpdateStatus {
    available: boolean;
    checkedAt: number;
    untracked?: boolean;
    latest?: string;
    error?: string;
}

export interface CompatIssue {
    file: string;
    line: number;
    module: string;
    name?: string;
}

export interface PluginCompat {
    id: string;
    name?: string;
    issues: CompatIssue[];
}

export interface CompatReport {
    /** Plugins that use Vencord functions the installed version does not have. */
    current: PluginCompat[];
    /** Plugins that use Vencord functions the pending update removes. */
    update?: { target: string; plugins: PluginCompat[] };
}

export interface BuildIssue {
    file: string;
    line?: number;
    message: string;
}

export interface PluginLinkResult {
    upToDate: boolean;
}

export interface UserPlugin {
    id: string;
    kind: "folder" | "file";
    enabled: boolean;
    path: string;
    name?: string;
    description?: string;
    authors: string[];
    isGit: boolean;
    hasNative: boolean;
    updatable: boolean;
    source?: PluginSource;
    update?: PluginUpdateStatus;
    buildIssues?: BuildIssue[];
}

export interface StagedCandidate {
    id: string;
    kind: "folder" | "file";
    relPath: string;
    targetName: string;
    name?: string;
    description?: string;
    exists: boolean;
}

export interface StageResult {
    stagingId: string;
    label: string;
    candidates: StagedCandidate[];
}

export interface PluginInstallOutcome {
    installed: string[];
    stage?: StageResult;
}

export interface AppConfig {
    vencordDir: string;
    repoUrl: string;
    repoBranch: string;
    devBuild: boolean;
    restartDiscordAfterBuild: boolean;
    needsRebuild: boolean;
    targets: string[];
    plugins: Record<string, PluginSource>;
    pluginUpdates: Record<string, PluginUpdateStatus>;
    lastPluginCheck?: number;
    lastUpdate?: UpdateInfo;
    buildIssues?: Record<string, BuildIssue[]>;
    onboarded: boolean;
}

export type EditableConfig = Partial<Pick<AppConfig, "vencordDir" | "repoUrl" | "repoBranch" | "devBuild" | "restartDiscordAfterBuild" | "targets">>;

export interface InstallOptions {
    removeOfficial: boolean;
    inject: boolean;
    targets: string[];
}

export type TaskStatus = "running" | "success" | "error" | "cancelled";
export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface TaskStep {
    id: string;
    label: string;
    status: StepStatus;
    detail?: string;
}

export interface TaskState {
    id: string;
    title: string;
    status: TaskStatus;
    steps: TaskStep[];
    startedAt: number;
    endedAt?: number;
    error?: string;
    hint?: string;
    brokenPlugins?: string[];
}

export interface TaskResult<T = void> {
    ok: boolean;
    data?: T;
    error?: string;
    hint?: string;
}

export type LogLevel = "info" | "cmd" | "out" | "err" | "success" | "warn" | "error";

export interface LogLine {
    id: number;
    taskId?: string;
    level: LogLevel;
    text: string;
    ts: number;
}

export type ChangeScope = "config" | "env" | "discord" | "vencord" | "plugins";

export type AppEvent =
    | { type: "log"; line: LogLine }
    | { type: "task"; task: TaskState }
    | { type: "changed"; scope: ChangeScope[] }
    | { type: "appUpdate"; state: AppUpdateState };
