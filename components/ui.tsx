import Link from "next/link";
import type { ReactNode } from "react";
import { PRIORITY_LABEL, STATUS_LABEL, STEP_STATUS_LABEL, type Priority, type Status, type StepStatus } from "@/lib/constants";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Tone = "ok" | "warn" | "danger" | "info" | "neutral" | "accent";
const TONE: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-accent-soft text-[#ff7b82]",
  info: "bg-info-soft text-info",
  neutral: "bg-neutral-soft text-fg-2",
  accent: "bg-accent-soft text-[#ff7b82]",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", TONE[tone])}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<Status, Tone> = {
  not_started: "neutral",
  in_progress: "info",
  pending_approval: "warn",
  on_hold: "neutral",
  completed: "ok",
  overdue: "danger",
  cancelled: "neutral",
};
export function StatusBadge({ status }: { status: Status }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
const PRIORITY_TONE: Record<Priority, Tone> = { low: "neutral", medium: "info", high: "warn", critical: "danger" };
export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}
const STEP_TONE: Record<StepStatus, Tone> = { pending: "neutral", in_progress: "info", blocked: "danger", done: "ok", skipped: "neutral" };
export function StepBadge({ status }: { status: StepStatus }) {
  return <Badge tone={STEP_TONE[status]}>{STEP_STATUS_LABEL[status]}</Badge>;
}

export function Progress({ value, compact }: { value: number; compact?: boolean }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex items-center gap-2" aria-label={`${v}% complete`}>
      <div className={cx("h-1.5 rounded-full bg-surface-3 overflow-hidden", compact ? "w-16" : "w-full min-w-16")}>
        <div className={cx("h-full rounded-full", v >= 100 ? "bg-ok" : "bg-silver")} style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs tabular-nums text-fg-2 w-9 text-right">{v}%</span>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KpiCard({ label, value, hint, tone, href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; href?: string }) {
  const body = (
    <div className={cx("card card-pad h-full transition-colors", href && "hover:border-line-strong")}>
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted">
        {tone && <span className={cx("h-1.5 w-1.5 rounded-full", tone === "danger" || tone === "accent" ? "bg-accent" : tone === "warn" ? "bg-warn" : tone === "ok" ? "bg-ok" : tone === "info" ? "bg-info" : "bg-muted")} />}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-fg">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-medium text-fg-2">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("card min-w-0", className)}>
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="section-title">{title}</h2>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function OrgTags({ codes }: { codes: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {codes.map((c) => (
        <span key={c} className="rounded border border-line px-1 text-[10px] font-semibold tracking-wide text-silver">
          {c}
        </span>
      ))}
    </span>
  );
}
