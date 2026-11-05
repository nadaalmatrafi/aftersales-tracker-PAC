"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LayoutDashboard, ListChecks, FileBarChart, Bell, Users, Building2, ScrollText, Settings, UserCircle } from "lucide-react";
import { cx } from "./ui";

const ICONS = { Inbox, LayoutDashboard, ListChecks, FileBarChart, Bell, Users, Building2, ScrollText, Settings, UserCircle };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

export function NavLinks({ items, admin }: { items: NavItem[]; admin: NavItem[] }) {
  const path = usePathname();
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
      {admin.length > 0 && (
        <>
          <p className="mt-6 mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted">Administration</p>
          <ul className="space-y-0.5">{admin.map(render)}</ul>
        </>
      )}
    </nav>
  );
}
