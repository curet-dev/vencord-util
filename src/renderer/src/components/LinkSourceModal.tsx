import type { UserPlugin } from "@shared/types";
import { Link2 } from "lucide-react";
import { useState } from "react";
import { act, useBusy } from "../store";
import { Button, GithubIcon, Modal } from "./ui";

/** The link the plugin is currently tracked with, in the form a user would paste it. */
function currentLink(plugin: UserPlugin) {
    const source = plugin.source;
    if (!source?.url || source.type === "local") return "";
    const url = source.url.replace(/\.git$/, "");
    if (source.type === "git-subdir" && source.subdir && source.ref && /github\.com/.test(url)) return `${url}/tree/${source.ref}/${source.subdir}`;
    return url;
}

export function LinkSourceModal({ plugin, onClose }: { plugin: UserPlugin; onClose(): void }) {
    const busy = useBusy();
    const [url, setUrl] = useState(() => currentLink(plugin));
    const [running, setRunning] = useState(false);
    const name = plugin.name ?? plugin.id;
    const linked = Boolean(currentLink(plugin));

    const submit = async () => {
        if (!url.trim()) return;
        setRunning(true);
        const result = await act(window.vu.plugins.linkSource(plugin.id, url.trim()), data =>
            data?.upToDate ? `“${name}” is linked and up to date` : `“${name}” is linked – an update is available`
        );
        setRunning(false);
        if (result.ok) onClose();
    };

    return (
        <Modal
            title={linked ? `Change repository of “${name}”` : `Link “${name}” to Git`}
            onClose={() => !running && onClose()}
            width={560}
            footer={
                <>
                    <Button variant="ghost" disabled={running} onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="primary" icon={Link2} loading={running} disabled={busy || !url.trim()} onClick={submit}>
                        Link
                    </Button>
                </>
            }
        >
            <p style={{ marginTop: 0 }}>
                Paste the repository the plugin comes from – or the plugin's folder inside it. Vencord Util compares it with your copy and can then check for
                and install updates. Your files stay untouched until you update.
            </p>
            <form
                onSubmit={event => {
                    event.preventDefault();
                    submit();
                }}
            >
                <div className="input-group">
                    <GithubIcon size={15} />
                    <input
                        className="input"
                        placeholder="https://github.com/user/plugin  ·  …/tree/main/pluginFolder"
                        value={url}
                        onChange={event => setUrl(event.target.value)}
                        spellCheck={false}
                        // biome-ignore lint/a11y/noAutofocus: the dialog exists only to enter this link
                        autoFocus
                    />
                </div>
            </form>
            <p className="small faint" style={{ marginBottom: 0 }}>
                Works with GitHub, GitLab, Codeberg and any other Git host, as well as direct links to a single <code>.ts/.tsx</code> file.
            </p>
        </Modal>
    );
}
