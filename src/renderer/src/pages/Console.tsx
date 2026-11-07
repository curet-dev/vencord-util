import { Copy, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { copyLogs, LogView, TaskPanel } from "../components/TaskView";
import { Button } from "../components/ui";
import { useStore } from "../store";

export function ConsolePage() {
    const logs = useStore(s => s.logs);
    const task = useStore(s => s.task);
    const [onlyTask, setOnlyTask] = useState(false);
    const lines = useMemo(() => (onlyTask && task ? logs.filter(l => l.taskId === task.id) : logs), [logs, onlyTask, task]);

    return (
        <>
            <div className="page-header">
                <div>
                    <h1 className="page-title">Console</h1>
                    <p className="page-sub">Every command Vencord Util runs for you, with its output.</p>
                </div>
                <div className="row" style={{ gap: 4 }}>
                    {task && (
                        <Button variant={onlyTask ? "secondary" : "ghost"} size="sm" onClick={() => setOnlyTask(v => !v)}>
                            Last task only
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" icon={Copy} onClick={() => copyLogs(lines)}>
                        Copy
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        onClick={async () => {
                            await window.vu.clearLogs();
                            useStore.setState({ logs: [] });
                        }}
                    >
                        Clear
                    </Button>
                </div>
            </div>
            {task && (
                <div style={{ marginBottom: 12 }}>
                    <TaskPanel task={task} compact />
                </div>
            )}
            <LogView lines={lines} style={{ height: task ? "calc(100vh - 360px)" : "calc(100vh - 280px)", minHeight: 260 }} />
        </>
    );
}
