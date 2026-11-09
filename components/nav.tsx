"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Inbox, LayoutDashboard, ListChecks, FileBarChart, Bell, Users, Building2, ScrollText, Settings, UserCircle, CalendarClock, Plug, Trash2, ExternalLink } from "lucide-react";
import { cx } from "./ui";

const ICONS = { Inbox, LayoutDashboard, ListChecks, FileBarChart, Bell, Users, Building2, ScrollText, Settings, UserCircle, CalendarClock, Plug, Trash2 };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

export function NavLinks({ items, admin, units = [], epmsUrl }: { items: NavItem[]; admin: NavItem[]; units?: { id: number; code: string; name: string }[]; epmsUrl?: string }) {
  const path = usePathname();
  const search = useSearchParams();
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const render = (it: NavItem) => {
    const Icon = ICONS[it.icon];
    const active = isActive(it.href);
    return (
      <li key={it.href}>
        <Link
          href={it.href}
          aria-current={active ? "page" : undefined}
          className={cx(
            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
            active ? "bg-accent-soft font-medium text-accent" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
          )}
        >
          <Icon size={16} strokeWidth={1.75} className={active ? "text-accent" : "text-muted"} aria-hidden />
          <span className="flex-1">{it.label}</span>
          {!!it.badge && <span className="rounded bg-accent px-1.5 text-[10px] font-semibold text-white">{it.badge > 99 ? "99+" : it.badge}</span>}
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label="Main">
      <ul className="space-y-0.5">{items.map(render)}</ul>
      {units.length > 0 && (
        <>
          <p className="mt-6 mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted">Business units</p>
          <ul className="space-y-0.5">
            {[{ id: 0, code: "All", name: "All companies" }, ...units].map((o) => {
              const active = path === "/overview" && (o.id === 0 ? !search.get("org") : search.get("org") === String(o.id));
              return (
                <li key={o.id}>
                  <Link
                    href={o.id === 0 ? "/overview" : `/overview?org=${o.id}`}
                    title={o.name}
                    aria-current={active ? "page" : undefined}
                    className={cx("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors", active ? "bg-accent-soft font-medium text-accent" : "text-fg-2 hover:bg-surface-2 hover:text-fg")}
                  >
                    <span className={cx("h-1.5 w-1.5 rounded-full", active ? "bg-accent" : "bg-muted")} aria-hidden />
                    <span className="flex-1 truncate">{o.code}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {admin.length > 0 && (
        <>
          <p className="mt-6 mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted">Administration</p>
          <ul className="space-y-0.5">{admin.map(render)}</ul>
        </>
      )}
      {epmsUrl && (
        <a href={epmsUrl} target="_blank" rel="noopener noreferrer" className="mt-6 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-fg-2 hover:bg-surface-2 hover:text-fg">
          <ExternalLink size={16} strokeWidth={1.75} className="text-muted" aria-hidden />
          <span className="flex-1">Open EPMS</span>
        </a>
      )}
    </nav>
  );
}
