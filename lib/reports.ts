import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { CurrentUser } from "./auth";
import { actionVisibility } from "./access";
import { listActions, type ActionFilters, type ActionRow } from "./queries";
import { statusBreakdown } from "./dashboard";
import { objectiveVisibility } from "./objectives";
import { CATEGORY_LABEL, PRIORITY_LABEL, ROLE_LABEL, STATUS_LABEL, type Category, type Priority, type Role } from "./constants";
import { fmtDate, fmtDateTime } from "./dates";

export const REPORTS = {
  executive: { title: "Executive Action Plan Report", desc: "Every action plan with owner, current position, progress and impact." },
  overdue: { title: "Overdue Action Report", desc: "Open actions past their target date." },
  department: { title: "Department Performance Report", desc: "Completion and overdue figures by department." },
  director: { title: "Director Accountability Report", desc: "Ownership, completion and open work by responsible person." },
  organization: { title: "Organization Performance Report", desc: "PAC, PCVC and DEX performance side by side." },
  objectives: { title: "30/60/90-Day Objectives Report", desc: "Deliverables, responsibility, evidence and approval." },
  impact: { title: "Business Impact Report", desc: "Expected versus confirmed financial and operational impact." },
  completed: { title: "Completed Initiatives Report", desc: "Approved completions with dates and approvers." },
  decisions: { title: "Pending Management Decisions Report", desc: "Approvals and escalations awaiting management." },
} as const;
export type ReportType = keyof typeof REPORTS;

export type Column = { key: string; label: string; width?: number };
export type Report = { title: string; subtitle: string; columns: Column[]; rows: Record<string, string | number>[] };

const ACTION_COLS: Column[] = [
  { key: "code", label: "ID", width: 10 },
  { key: "org", label: "Organization", width: 12 },
  { key: "department", label: "Department", width: 18 },
  { key: "responsible", label: "Responsible", width: 18 },
  { key: "task", label: "Point / Task", width: 50 },
  { key: "status", label: "Status", width: 14 },
  { key: "deadline", label: "Deadline", width: 14 },
  { key: "progress", label: "Progress %", width: 10 },
  { key: "with", label: "Currently with", width: 20 },
  { key: "latest", label: "Latest update", width: 36 },
  { key: "impact", label: "Business impact", width: 30 },
];

function actionRow(a: ActionRow) {
  return {
    code: a.code,
    org: a.org_codes.join(", "),
    department: a.department ?? "Not assigned",
    responsible: a.owner_name,
    task: a.point_task,
    status: STATUS_LABEL[a.effective_status],
    deadline: a.target_date ? fmtDate(a.target_date) : (a.timeline_note ?? "Not set"),
    progress: a.progress,
    with: a.waiting_reason === "closed" ? "—" : `${a.waiting_on_name ?? ""}${a.waiting_on_step ? ` (${a.waiting_on_step})` : ""}`,
    latest: a.last_update_at ? `${fmtDate(a.last_update_at)}: ${a.last_update_note ?? ""}` : "No update",
    impact: a.business_impact ?? "",
  };
}

const AGG_COLS = (first: string): Column[] => [
  { key: "name", label: first, width: 28 },
  { key: "total", label: "Total", width: 10 },
  { key: "completed", label: "Completed", width: 12 },
  { key: "onTrack", label: "Open – on track", width: 14 },
  { key: "overdue", label: "Overdue", width: 10 },
  { key: "completionRate", label: "Completion %", width: 12 },
  { key: "avgProgress", label: "Avg progress %", width: 14 },
];

function filterLabel(f: ActionFilters) {
  const parts = [f.from || f.to ? `Period ${f.from ?? "…"} – ${f.to ?? "…"}` : null, f.status ? `Status: ${STATUS_LABEL[f.status]}` : null, f.priority ? `Priority: ${PRIORITY_LABEL[f.priority as Priority]}` : null].filter(Boolean);
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

export async function buildReport(u: CurrentUser, type: ReportType, f: ActionFilters): Promise<Report> {
  const meta = REPORTS[type];
  const subtitle = `Generated ${fmtDateTime(new Date())} by ${u.name}${filterLabel(f)}`;
  const base = { title: meta.title, subtitle };
  switch (type) {
    case "executive":
      return { ...base, columns: ACTION_COLS, rows: (await listActions(u, f)).map(actionRow) };
    case "overdue":
      return { ...base, columns: ACTION_COLS, rows: (await listActions(u, { ...f, status: "overdue" })).map(actionRow) };
    case "completed": {
      const rows = await listActions(u, { ...f, status: "completed" }, { orderBy: sql`a.completed_at DESC` });
      const ap = await db.execute(sql`SELECT a.id, u.name FROM action_plans a JOIN users u ON u.id = a.approved_by_id WHERE a.status = 'completed'`);
      const by = new Map((ap.rows as { id: number; name: string }[]).map((r) => [r.id, r.name]));
      return {
        ...base,
        columns: [...ACTION_COLS.filter((c) => !["with", "status"].includes(c.key)), { key: "completedAt", label: "Completed", width: 14 }, { key: "approvedBy", label: "Approved by", width: 18 }],
        rows: rows.map((a) => ({ ...actionRow(a), completedAt: fmtDate(a.completed_at), approvedBy: by.get(a.id) ?? "" })),
      };
    }
    case "department":
      return { ...base, columns: AGG_COLS("Department"), rows: statusBreakdown(await listActions(u, f), (a) => (a.department ? `${a.org_codes[0] ?? ""} · ${a.department}` : null), "Department not assigned") };
    case "organization":
      return { ...base, columns: AGG_COLS("Organization"), rows: statusBreakdown(await listActions(u, f), (a) => a.org_codes) };
    case "director": {
      const rows = await listActions(u, f);
      const roles = await db.execute(sql`SELECT id, role::text FROM users`);
      const roleOf = new Map((roles.rows as { id: string; role: Role }[]).map((r) => [r.id, r.role]));
      const map = new Map<string, Record<string, string | number>>();
      for (const a of rows) {
        if (a.status === "cancelled") continue;
        const e = map.get(a.owner_id) ?? { name: a.owner_name, role: ROLE_LABEL[roleOf.get(a.owner_id) ?? "employee"], owned: 0, completed: 0, open: 0, overdue: 0, pending: 0, stale: 0, holding: 0 };
        (e.owned as number)++;
        if (a.status === "completed") (e.completed as number)++;
        else {
          (e.open as number)++;
          if (a.effective_status === "overdue") (e.overdue as number)++;
          if (a.status === "pending_approval") (e.pending as number)++;
          if (Date.now() - new Date(a.last_update_at ?? a.created_at).getTime() > 7 * 86_400_000) (e.stale as number)++;
        }
        map.set(a.owner_id, e);
      }
      for (const a of rows) {
        if (a.waiting_reason === "closed" || !a.waiting_on_id) continue;
        const e = map.get(a.waiting_on_id);
        if (e) (e.holding as number)++;
      }
      const order = ["Director", "CEO", "System Owner", "Manager", "Employee"];
      return {
        ...base,
        columns: [
          { key: "name", label: "Responsible person", width: 24 },
          { key: "role", label: "Role", width: 12 },
          { key: "owned", label: "Owned", width: 9 },
          { key: "completed", label: "Completed", width: 11 },
          { key: "open", label: "Open", width: 9 },
          { key: "overdue", label: "Overdue", width: 10 },
          { key: "pending", label: "Pending approval", width: 14 },
          { key: "stale", label: "No update 7+ days", width: 15 },
          { key: "holding", label: "Currently holding", width: 15 },
        ],
        rows: [...map.values()].sort((a, b) => order.indexOf(String(a.role)) - order.indexOf(String(b.role)) || Number(b.overdue) - Number(a.overdue)),
      };
    }
    case "impact": {
      const r = await db.execute(sql`
        SELECT a.code, a.point_task, (SELECT string_agg(o.code, ', ') FROM action_organizations ao JOIN organizations o ON o.id = ao.organization_id WHERE ao.action_id = a.id) AS org,
               u.name AS responsible, i.*, cu.name AS confirmed_by
          FROM impact_records i JOIN action_plans a ON a.id = i.action_id JOIN users u ON u.id = a.owner_id LEFT JOIN users cu ON cu.id = i.actuals_confirmed_by
         WHERE ${actionVisibility(u)} ORDER BY a.id`);
      const n = (v: unknown) => (v == null ? "" : Number(v));
      return {
        ...base,
        columns: [
          { key: "code", label: "ID", width: 10 }, { key: "org", label: "Org", width: 10 }, { key: "task", label: "Point / Task", width: 40 }, { key: "responsible", label: "Responsible", width: 16 },
          { key: "er", label: "Expected revenue", width: 14 }, { key: "ar", label: "Actual revenue", width: 14 }, { key: "es", label: "Expected savings", width: 14 }, { key: "as", label: "Actual savings", width: 14 },
          { key: "ec", label: "Est. cost", width: 12 }, { key: "ac", label: "Actual cost", width: 12 }, { key: "branches", label: "Branches", width: 9 }, { key: "employees", label: "Employees", width: 9 },
          { key: "confirmed", label: "Actuals confirmed", width: 18 }, { key: "source", label: "Data source", width: 20 },
        ],
        rows: (r.rows as Record<string, unknown>[]).map((x) => ({
          code: String(x.code), org: String(x.org ?? ""), task: String(x.point_task), responsible: String(x.responsible),
          er: n(x.expected_revenue), ar: n(x.actual_revenue), es: n(x.expected_savings), as: n(x.actual_savings), ec: n(x.estimated_cost), ac: n(x.actual_cost),
          branches: n(x.branches_affected), employees: n(x.employees_affected),
          confirmed: x.actuals_confirmed_at ? `${x.confirmed_by} · ${fmtDate(x.actuals_confirmed_at as string)}` : "Not confirmed",
          source: String(x.data_source ?? ""),
        })),
      };
    }
    case "objectives": {
      const r = await db.execute(sql`
        SELECT o.horizon::text, o.title, o.category::text, org.code AS org, i.deliverable, r.name AS responsible, i.deadline::text, i.is_done, i.approval_status, i.evidence_note, ab.name AS approver
          FROM objectives o JOIN objective_items i ON i.objective_id = o.id LEFT JOIN organizations org ON org.id = o.organization_id
          LEFT JOIN users r ON r.id = i.responsible_id LEFT JOIN users ab ON ab.id = i.approved_by
         WHERE o.archived_at IS NULL AND ${objectiveVisibility(u)} ORDER BY o.horizon::text::int, o.id, i.id`);
      return {
        ...base,
        columns: [
          { key: "horizon", label: "Horizon", width: 9 }, { key: "objective", label: "Objective", width: 30 }, { key: "area", label: "Area", width: 18 }, { key: "org", label: "Org", width: 8 },
          { key: "deliverable", label: "Deliverable", width: 40 }, { key: "responsible", label: "Responsible", width: 18 }, { key: "deadline", label: "Deadline", width: 13 },
          { key: "state", label: "Status", width: 18 }, { key: "evidence", label: "Evidence", width: 30 },
        ],
        rows: (r.rows as Record<string, unknown>[]).map((x) => ({
          horizon: `${x.horizon}-day`, objective: String(x.title), area: x.category ? CATEGORY_LABEL[x.category as Category] : "", org: String(x.org ?? "All"),
          deliverable: String(x.deliverable), responsible: String(x.responsible ?? ""), deadline: fmtDate(x.deadline as string),
          state: x.approval_status === "approved" ? `Approved (${x.approver})` : x.approval_status === "pending" ? "Awaiting approval" : x.approval_status === "rejected" ? "Rejected" : "Open",
          evidence: String(x.evidence_note ?? ""),
        })),
      };
    }
    case "decisions": {
      const vis = actionVisibility(u);
      const r = await db.execute(sql`
        SELECT 'Approval: ' || CASE r.type WHEN 'completion' THEN 'completion' ELSE 'deadline extension to ' || to_char(r.requested_date, 'DD Mon YYYY') END AS kind,
               a.code AS ref, a.point_task AS item, rb.name AS raised_by, r.requested_at AS since, COALESCE(r.request_note, '') AS note
          FROM approval_records r JOIN action_plans a ON a.id = r.action_id JOIN users rb ON rb.id = r.requested_by WHERE r.status = 'pending' AND ${vis}
        UNION ALL
        SELECT 'Escalation', a.code, a.point_task, o.name, a.escalated_at, COALESCE(a.escalation_note, '')
          FROM action_plans a JOIN users o ON o.id = a.owner_id WHERE a.is_escalated AND a.status NOT IN ('completed','cancelled') AND ${vis}

        ORDER BY since`);
      return {
        ...base,
        columns: [{ key: "kind", label: "Decision type", width: 26 }, { key: "ref", label: "Reference", width: 14 }, { key: "item", label: "Item", width: 50 }, { key: "raised", label: "Raised by", width: 18 }, { key: "since", label: "Waiting since", width: 16 }, { key: "note", label: "Notes", width: 40 }],
        rows: (r.rows as Record<string, unknown>[]).map((x) => ({ kind: String(x.kind), ref: String(x.ref), item: String(x.item), raised: String(x.raised_by ?? ""), since: fmtDate(x.since as string), note: String(x.note) })),
      };
    }
  }
}

export async function toXlsx(r: Report): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Business Performance";
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "), { views: [{ state: "frozen", ySplit: 3 }] });
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([r.subtitle]).font = { italic: true, size: 9, color: { argb: "FF666666" } };
  const head = ws.addRow(r.columns.map((c) => c.label));
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B1E25" } }));
  for (const row of r.rows) ws.addRow(r.columns.map((c) => row[c.key] ?? ""));
  r.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width ?? 16;
    ws.getColumn(i + 1).alignment = { wrapText: true, vertical: "top" };
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: Math.max(1, r.columns.length) } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function toPdf(r: Report): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const { autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(200, 16, 46);
  doc.rect(36, 30, 4, 22, "F");
  doc.setFont("helvetica", "bold").setFontSize(14).text(r.title, 48, 44);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(110).text(`PAC | PCVC | DEX · ${r.subtitle}`, 48, 58);
  const totalW = r.columns.reduce((s, c) => s + (c.width ?? 16), 0) || 1;
  autoTable(doc, {
    startY: 70,
    head: [r.columns.map((c) => c.label)],
    body: r.rows.length ? r.rows.map((row) => r.columns.map((c) => String(row[c.key] ?? ""))) : [[{ content: "No records match the selected filters.", colSpan: Math.max(1, r.columns.length) }]],
    styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: [27, 30, 37], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 246, 248] },
    columnStyles: Object.fromEntries(r.columns.map((c, i) => [i, { cellWidth: ((c.width ?? 16) / totalW) * (w - 72) }])),
    margin: { left: 36, right: 36 },
    didDrawPage: () => {
      doc.setFontSize(7).setTextColor(140).text(`Page ${doc.getNumberOfPages()} · Confidential — internal management use`, 36, doc.internal.pageSize.getHeight() - 16);
    },
  });
  return Buffer.from(doc.output("arraybuffer"));
}

/** One-page CEO summary: headline figures, items needing attention and current bottlenecks (A4 landscape). */
export async function ceoSummaryPdf(u: CurrentUser, f: ActionFilters, filterText: string): Promise<Buffer> {
  const { kpis, holders } = await import("./dashboard");
  const rows = await listActions(u, f);
  const orgs = (await db.execute(sql`SELECT code FROM organizations WHERE is_active ORDER BY id`)).rows as { code: string }[];
  const k = kpis(rows, orgs);
  const open = rows.filter((a) => a.status !== "completed" && a.status !== "cancelled");
  const attention = open
    .filter((a) => a.effective_status === "overdue" || a.is_escalated || a.step_blocked || a.priority === "critical" || a.status === "pending_approval")
    .slice(0, 12);
  const people = holders(rows).slice(0, 8);

  const { jsPDF } = await import("jspdf");
  const { autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const RED: [number, number, number] = [206, 16, 44];
  const BLACK: [number, number, number] = [23, 22, 20];
  const ORANGE: [number, number, number] = [251, 134, 6];
  doc.setFillColor(...RED).rect(0, 0, W, 6, "F");
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(...BLACK).text("Business Performance — CEO Summary", 36, 40);
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(110).text(`Petromin Auto Care · PAC | PCVC | DEX · ${fmtDateTime(new Date())} · ${u.name}${filterText}`, 36, 54);

  const tiles: [string, string, [number, number, number]][] = [
    ["Total", String(k.total), BLACK],
    ["Active", String(k.active), BLACK],
    ["Completed", String(k.completed), [21, 128, 61]],
    ["Overdue", String(k.overdue), RED],
    ["Pending approval", String(k.pendingApproval), ORANGE],
    ["Critical / escalated", String(k.critical), RED],
    ["Completion rate", k.completionRate == null ? "—" : `${k.completionRate}%`, BLACK],
    ["No update 7+ days", String(k.stale), BLACK],
  ];
  const tw = (W - 72 - 7 * 8) / 8;
  tiles.forEach(([label, value, color], i) => {
    const x = 36 + i * (tw + 8);
    doc.setDrawColor(228, 227, 225).setFillColor(255, 255, 255).roundedRect(x, 68, tw, 48, 4, 4, "FD");
    doc.setFontSize(7).setTextColor(110).text(label.toUpperCase(), x + 8, 82);
    doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(...color).text(value, x + 8, 106);
    doc.setFont("helvetica", "normal");
  });

  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...BLACK).text("Requires attention — where each item stands", 36, 140);
  autoTable(doc, {
    startY: 146,
    margin: { left: 36, right: 36 },
    head: [["ID", "Point / Task", "Responsible", "Currently with", "Target", "Status", "%"]],
    body: attention.length
      ? attention.map((a) => [
          a.code,
          a.point_task.length > 110 ? `${a.point_task.slice(0, 107)}…` : a.point_task,
          a.owner_name,
          `${a.waiting_on_name ?? ""}${a.acting_for ? ` (for ${a.acting_for})` : ""}${a.waiting_on_step ? ` — ${a.waiting_on_step}` : ""}`,
          a.target_date ? fmtDate(a.target_date) : (a.timeline_note ?? "—"),
          STATUS_LABEL[a.effective_status],
          String(a.progress),
        ])
      : [[{ content: "Nothing overdue, blocked, escalated or awaiting approval.", colSpan: 7 }]],
    styles: { fontSize: 7.5, cellPadding: 3, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: BLACK, textColor: 255 },
    columnStyles: { 0: { cellWidth: 48 }, 1: { cellWidth: 300 }, 2: { cellWidth: 80 }, 3: { cellWidth: 170 }, 4: { cellWidth: 70 }, 5: { cellWidth: 66 }, 6: { cellWidth: 30, halign: "right" } },
    didParseCell: (d) => {
      if (d.section === "body" && d.column.index === 5 && d.cell.raw === "Overdue") d.cell.styles.textColor = RED;
    },
  });
  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...BLACK).text("Who is holding open work", 36, y);
  autoTable(doc, {
    startY: y + 6,
    margin: { left: 36, right: W / 2 },
    head: [["Person", "Open", "Overdue", "Blocked"]],
    body: people.length ? people.map((p) => [`${p.name}${p.actingFor ? ` (covering for ${p.actingFor})` : ""}`, String(p.open), String(p.overdue), String(p.blocked)]) : [["No open actions", "", "", ""]],
    styles: { fontSize: 7.5, cellPadding: 3 },
    headStyles: { fillColor: BLACK, textColor: 255 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
  });
  const byOrg = k.byOrg.map((o) => `${o.code} ${o.n}`).join("   ·   ");
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...BLACK).text("By company", W / 2 + 18, y);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(60).text(byOrg || "—", W / 2 + 18, y + 18);
  doc.setFontSize(7).setTextColor(140).text("Confidential — internal management use. Figures are calculated from live action plan records.", 36, doc.internal.pageSize.getHeight() - 16);
  return Buffer.from(doc.output("arraybuffer"));
}
