import type { PatchKind } from "@shared/types";
import { AlertCircle, CheckCircle2, Info, Loader2, type LucideIcon, MoreHorizontal, X } from "lucide-react";
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useStore } from "../store";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
    icon?: LucideIcon;
    loading?: boolean;
    iconOnly?: boolean;
};

export function Button({ variant = "secondary", size = "md", icon: Icon, loading, iconOnly, children, className, disabled, ...rest }: BtnProps) {
    const iconSize = size === "sm" ? 14 : 16;
    const cls = ["btn", variant !== "secondary" && variant, size !== "md" && size, iconOnly && "icon", className].filter(Boolean).join(" ");
    return (
        <button type="button" className={cls} disabled={disabled || loading} {...rest}>
            {loading ? <Loader2 size={iconSize} className="spin" /> : Icon && <Icon size={iconSize} />}
            {!iconOnly && children}
        </button>
    );
}

export function Badge({ color, children, noDot }: { color?: "green" | "yellow" | "red" | "accent" | "blue"; children: ReactNode; noDot?: boolean }) {
    return <span className={["badge", color, noDot && "no-dot"].filter(Boolean).join(" ")}>{children}</span>;
}

export function Switch({ on, onChange, disabled, title }: { on: boolean; onChange(v: boolean): void; disabled?: boolean; title?: string }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            title={title}
            className={`switch${on ? " on" : ""}`}
            disabled={disabled}
            onClick={e => {
                e.stopPropagation();
                onChange(!on);
            }}
        />
    );
}

export function Checkbox({ on, onChange, disabled }: { on: boolean; onChange?(value: boolean): void; disabled?: boolean }) {
    return (
        <input
            type="checkbox"
            className="checkbox"
            checked={on}
            disabled={disabled}
            onClick={event => event.stopPropagation()}
            onChange={event => onChange?.(event.target.checked)}
        />
    );
}

export function GithubIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
        </svg>
    );
}

export function Spinner({ size = 16 }: { size?: number }) {
    return <Loader2 size={size} className="spin" />;
}

export interface MenuItem {
    label: string;
    icon?: LucideIcon;
    onClick(): void;
    danger?: boolean;
    disabled?: boolean;
    hidden?: boolean;
}

export function Menu({ items, disabled, title = "More actions" }: { items: MenuItem[]; disabled?: boolean; title?: string }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const visible = items.filter(item => !item.hidden);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: MouseEvent) => {
            if (!ref.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    if (!visible.length) return null;
    return (
        <div className="menu" ref={ref}>
            <Button size="sm" variant="ghost" iconOnly icon={MoreHorizontal} title={title} disabled={disabled} onClick={() => setOpen(o => !o)} />
            {open && (
                <div className="menu-pop" role="menu">
                    {visible.map(item => (
                        <button
                            type="button"
                            key={item.label}
                            role="menuitem"
                            className={`menu-item${item.danger ? " danger" : ""}`}
                            disabled={item.disabled}
                            onClick={() => {
                                setOpen(false);
                                item.onClick();
                            }}
                        >
                            {item.icon && <item.icon size={14} />}
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function Modal({
    title,
    children,
    footer,
    onClose,
    width
}: {
    title: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    onClose(): void;
    width?: number;
}) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);
    return (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="modal" style={width ? { width: `min(${width}px, calc(100vw - 48px))` } : undefined}>
                <div className="modal-head">
                    <h2 className="modal-title">{title}</h2>
                </div>
                <div className="modal-body">{children}</div>
                {footer && <div className="modal-foot">{footer}</div>}
            </div>
        </div>
    );
}

interface ConfirmOpts {
    title: string;
    text: ReactNode;
    confirm?: string;
    danger?: boolean;
}

const useConfirmStore = create<{ req: (ConfirmOpts & { resolve(v: boolean): void }) | null }>(() => ({ req: null }));

export function confirmDialog(opts: ConfirmOpts) {
    return new Promise<boolean>(resolve => useConfirmStore.setState({ req: { ...opts, resolve } }));
}

export function ConfirmHost() {
    const req = useConfirmStore(s => s.req);
    if (!req) return null;
    const close = (v: boolean) => {
        req.resolve(v);
        useConfirmStore.setState({ req: null });
    };
    return (
        <Modal
            title={req.title}
            onClose={() => close(false)}
            width={460}
            footer={
                <>
                    <Button variant="ghost" onClick={() => close(false)}>
                        Cancel
                    </Button>
                    <Button variant={req.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
                        {req.confirm ?? "Continue"}
                    </Button>
                </>
            }
        >
            {req.text}
        </Modal>
    );
}

export function Toasts() {
    const toasts = useStore(s => s.toasts);
    const dismiss = useStore(s => s.dismissToast);
    return (
        <div className="toasts">
            {toasts.map(t => (
                <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
                    {t.kind === "success" ? <CheckCircle2 size={16} /> : t.kind === "error" ? <AlertCircle size={16} /> : <Info size={16} />}
                    <div className="grow">
                        <div className="tt">{t.title}</div>
                        {t.text && <div className="tx">{t.text}</div>}
                    </div>
                    <X size={14} className="faint" />
                </div>
            ))}
        </div>
    );
}

export const patchInfo: Record<PatchKind, { label: string; color: "green" | "yellow" | "red" | "accent" | "blue" | undefined }> = {
    source: { label: "Vencord (source)", color: "green" },
    official: { label: "Vencord (official)", color: "blue" },
    other: { label: "Foreign patch", color: "yellow" },
    broken: { label: "Broken", color: "red" },
    none: { label: "Not patched", color: undefined }
};

export function PatchBadge({ kind, sourceDir }: { kind: PatchKind; sourceDir?: string }) {
    if (kind === "other" && sourceDir) return <Badge color="yellow">Vencord (other folder)</Badge>;
    const info = patchInfo[kind];
    return <Badge color={info.color}>{info.label}</Badge>;
}

const LOCALE = "en-US";

export function formatDate(iso?: string | number) {
    if (!iso) return "–";
    return new Date(iso).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" });
}

export function timeAgo(iso?: string | number) {
    if (!iso) return "–";
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
    if (diff < 60) return "just now";
    if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute");
    if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
    if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), "day");
    return formatDate(iso);
}

export function fmtTime(ts: number) {
    return new Date(ts).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
