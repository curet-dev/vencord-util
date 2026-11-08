import type { BuildIssue, CompatIssue, PluginCompat } from "@shared/types";

const MAX_SHOWN = 4;

function Remaining({ count }: { count: number }) {
    return count > 0 ? <li className="where">… and {count} more</li> : null;
}

export function CompatIssueText({ issue }: { issue: CompatIssue }) {
    return issue.name ? (
        <>
            <code>{issue.name}</code> from <code>{issue.module}</code>
        </>
    ) : (
        <>
            the module <code>{issue.module}</code>
        </>
    );
}

export function CompatIssueList({ issues }: { issues: CompatIssue[] }) {
    return (
        <ul className="issue-list">
            {issues.slice(0, MAX_SHOWN).map(issue => (
                <li key={`${issue.module}|${issue.name}`}>
                    Uses <CompatIssueText issue={issue} />{" "}
                    <span className="where mono">
                        ({issue.file}:{issue.line})
                    </span>
                </li>
            ))}
            <Remaining count={issues.length - MAX_SHOWN} />
        </ul>
    );
}

export function BuildIssueList({ issues }: { issues: BuildIssue[] }) {
    return (
        <ul className="issue-list selectable">
            {issues.slice(0, MAX_SHOWN).map(issue => (
                <li key={`${issue.file}|${issue.line}|${issue.message}`}>
                    {issue.message}{" "}
                    <span className="where mono">
                        ({issue.file}
                        {issue.line ? `:${issue.line}` : ""})
                    </span>
                </li>
            ))}
            <Remaining count={issues.length - MAX_SHOWN} />
        </ul>
    );
}

/** "Haunt uses Toasts from @webpack/common" – a one-line summary for toasts and dialogs. */
export function summarizeCompat(plugin: PluginCompat) {
    const first = plugin.issues[0];
    const what = first.name ? `“${first.name}” from ${first.module}` : `the module ${first.module}`;
    return `${plugin.name ?? plugin.id} uses ${what}${plugin.issues.length > 1 ? ` and ${plugin.issues.length - 1} more` : ""}`;
}
