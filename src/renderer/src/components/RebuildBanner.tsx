import { AlertTriangle, Hammer } from "lucide-react";
import { buildAndRestart } from "../actions";
import { useBusy, useStore } from "../store";
import { Button } from "./ui";

export function RebuildBanner() {
    const needsRebuild = useStore(s => s.config?.needsRebuild);
    const installed = useStore(s => s.vencord?.isVencord);
    const busy = useBusy();
    if (!needsRebuild || !installed) return null;

    return (
        <div className="banner fade-in">
            <AlertTriangle size={16} style={{ color: "var(--yellow)", flex: "none" }} />
            <div className="text">
                <b>Pending changes.</b> Plugins were added, removed or changed – rebuild Vencord so Discord loads them.
            </div>
            <Button variant="primary" size="sm" icon={Hammer} disabled={busy} onClick={() => buildAndRestart(true)}>
                Build &amp; restart Discord
            </Button>
        </div>
    );
}
