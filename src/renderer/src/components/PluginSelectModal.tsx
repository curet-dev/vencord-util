import type { StagedCandidate } from "@shared/types";
import { FileCode2, Folder, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { warnIfIncompatible } from "../actions";
import { useStore } from "../store";
import { Badge, Button, Checkbox, Modal } from "./ui";

const SEARCH_THRESHOLD = 8;

function CandidateRow({ candidate, selected, onToggle }: { candidate: StagedCandidate; selected: boolean; onToggle(): void }) {
    const Icon = candidate.kind === "folder" ? Folder : FileCode2;
    return (
        <div className={`select-item${selected ? " on" : ""}`} onClick={onToggle}>
            <Checkbox on={selected} onChange={onToggle} />
            <Icon size={16} className="faint" style={{ marginTop: 2, flex: "none" }} />
            <div className="grow">
                <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>{candidate.name ?? candidate.targetName}</span>
                    {candidate.exists && (
                        <Badge color="yellow" noDot>
                            replaces existing
                        </Badge>
                    )}
                </div>
                {candidate.description && <div className="small muted">{candidate.description}</div>}
                <div className="small faint mono" style={{ marginTop: 2 }}>
                    {candidate.relPath === "." ? candidate.targetName : candidate.relPath} → userplugins/{candidate.targetName}
                </div>
            </div>
        </div>
    );
}

export function PluginSelectModal() {
    const stage = useStore(s => s.stage);
    const setStage = useStore(s => s.setStage);
    const toast = useStore(s => s.toast);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!stage) return;
        const single = stage.candidates.length === 1;
        setSelected(new Set(stage.candidates.filter(candidate => single || !candidate.exists).map(candidate => candidate.id)));
        setQuery("");
    }, [stage]);

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const candidates = stage?.candidates ?? [];
        if (!needle) return candidates;
        return candidates.filter(candidate =>
            [candidate.name, candidate.targetName, candidate.description, candidate.relPath].some(value => value?.toLowerCase().includes(needle))
        );
    }, [stage, query]);

    if (!stage) return null;

    const single = stage.candidates.length === 1;
    const allSelected = selected.size === stage.candidates.length;
    const replacing = stage.candidates.filter(candidate => selected.has(candidate.id) && candidate.exists).length;

    const close = () => {
        window.vu.plugins.discard(stage.stagingId);
        setStage(null);
    };

    const toggle = (id: string) =>
        setSelected(previous => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const install = async () => {
        setBusy(true);
        const result = await window.vu.plugins.commit(stage.stagingId, [...selected]);
        setBusy(false);
        if (!result.ok) {
            toast({ kind: "error", title: result.error ?? "Installation failed", text: result.hint });
            return;
        }
        setStage(null);
        const count = result.data?.length ?? 0;
        toast({ kind: "success", title: `Installed ${count} ${count === 1 ? "plugin" : "plugins"}`, text: "Rebuild Vencord so Discord picks up the changes." });
        warnIfIncompatible(result.data ?? []);
    };

    return (
        <Modal
            title={single ? "Replace plugin?" : `Found ${stage.candidates.length} plugins`}
            onClose={close}
            width={600}
            footer={
                <>
                    {!single && (
                        <Button variant="ghost" onClick={() => setSelected(allSelected ? new Set() : new Set(stage.candidates.map(candidate => candidate.id)))}>
                            {allSelected ? "Select none" : "Select all"}
                        </Button>
                    )}
                    <div className="grow" />
                    <Button variant="ghost" onClick={close}>
                        Cancel
                    </Button>
                    <Button variant="primary" disabled={!selected.size} loading={busy} onClick={install}>
                        {single ? "Replace" : `Install ${selected.size}${replacing ? ` (replace ${replacing})` : ""}`}
                    </Button>
                </>
            }
        >
            <p style={{ marginTop: 0 }}>
                {single ? (
                    <>
                        A plugin named <code>{stage.candidates[0].targetName}</code> is already installed. Do you want to replace it with the new version?
                    </>
                ) : (
                    <>
                        Source: <span className="mono">{stage.label}</span>. Choose which plugins to install.
                    </>
                )}
            </p>
            {stage.candidates.length > SEARCH_THRESHOLD && (
                <div className="input-group" style={{ marginBottom: 12 }}>
                    <Search size={14} />
                    <input className="input" placeholder="Filter plugins …" value={query} onChange={event => setQuery(event.target.value)} />
                </div>
            )}
            {visible.map(candidate => (
                <CandidateRow key={candidate.id} candidate={candidate} selected={selected.has(candidate.id)} onToggle={() => toggle(candidate.id)} />
            ))}
            {!visible.length && <div className="empty small">No plugins match “{query}”.</div>}
        </Modal>
    );
}
