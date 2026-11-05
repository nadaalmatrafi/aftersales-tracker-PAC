import Link from "next/link";
import Image from "next/image";
import { sql } from "drizzle-orm";
import { Menu, LogOut } from "lucide-react";
import { db } from "@/db";
import { requireUser, isExecutive } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/constants";
import { NavLinks, type NavItem } from "@/components/nav";
import { logoutAction } from "../session-actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser({ allowPasswordChange: true });
  const unread = (await db.execute(sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${u.id} AND read_at IS NULL`)).rows[0] as { n: number };
  const items: NavItem[] = [
    { href: "/", label: "My Work", icon: "Inbox" },
    { href: "/overview", label: "Overview", icon: "LayoutDashboard" },
    { href: "/actions", label: "Action Plans", icon: "ListChecks" },
    { href: "/reports", label: "Reports", icon: "FileBarChart" },
    { href: "/notifications", label: "Notifications", icon: "Bell", badge: unread.n },
    { href: "/account", label: "Account", icon: "UserCircle" },
  ];
  const admin: NavItem[] = [];
  if (u.role === "system_owner") {
    admin.push(
      { href: "/admin/users", label: "Users & Permissions", icon: "Users" },
      { href: "/admin/organizations", label: "Companies", icon: "Building2" },
      { href: "/admin/audit", label: "Audit Log", icon: "ScrollText" },
      { href: "/admin/settings", label: "System Settings", icon: "Settings" },
    );
  } else if (isExecutive(u)) {
    admin.push({ href: "/admin/audit", label: "Audit Log", icon: "ScrollText" });
  }

  const sidebar = (
    <>
      <Link href="/" className="mb-6 block px-2.5" aria-label="Petromin Auto Care — Business Performance home">
        <Image src="/brand/petromin-auto-care.png" alt="Petromin Auto Care" width={734} height={192} priority className="h-auto w-full max-w-[190px]" />
        <span className="mt-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-2">Business Performance</span>
        <span className="block text-[10px] tracking-[0.2em] text-muted">PAC · PCVC · DEX</span>
      </Link>
      <NavLinks items={items} admin={admin} />
      <div className="mt-auto border-t border-line pt-4">
        <div className="px-2.5">
          <p className="truncate text-[13px] font-medium">{u.name}</p>
          <p className="truncate text-xs text-muted">{ROLE_LABEL[u.role]}{u.title ? ` · ${u.title}` : ""}</p>
        </div>
        <form action={logoutAction} className="mt-2">
          <button className="btn btn-ghost btn-sm w-full justify-start"><LogOut size={14} aria-hidden /> Sign out</button>
        </form>
      </div>
    </>
  );

  return (
    <div className="min-h-screen lg:flex">
      <div className="no-print hidden w-60 shrink-0 border-r border-line bg-surface lg:block">
        <aside className="sticky top-0 flex h-screen flex-col overflow-y-auto px-3 py-5">{sidebar}</aside>
      </div>
      <details className="no-print group border-b border-line bg-surface lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
          <Image src="/brand/petromin-auto-care.png" alt="Petromin Auto Care" width={734} height={192} className="h-8 w-auto" />
          <Menu size={18} aria-label="Menu" />
        </summary>
        <div className="flex flex-col px-3 pb-4">{sidebar}</div>
      </details>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
