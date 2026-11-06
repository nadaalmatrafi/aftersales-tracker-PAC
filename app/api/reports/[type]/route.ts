import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, canExport } from "@/lib/auth";
import { parseFilters } from "@/lib/queries";
import { buildReport, ceoSummaryPdf, REPORTS, toPdf, toXlsx, type ReportType } from "@/lib/reports";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest, ctx: { params: Promise<{ type: string }> }) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canExport(u)) return NextResponse.json({ error: "Export not permitted for your role" }, { status: 403 });
  const { type } = await ctx.params;
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const f = parseFilters(sp);
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = (name: string, ct: string) => ({ "Content-Type": ct, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" });

  if (type === "ceo-summary") {
    const filterText = [f.org ? "company filter" : "", f.person ? "people filter" : "", f.statuses?.length ? `status ${f.statuses.join("/")}` : ""].filter(Boolean).join(", ");
    const body = await ceoSummaryPdf(u, f, filterText ? ` · ${filterText}` : "");
    await audit(u.id, "report", type, "export", { format: "pdf", filters: sp });
    return new NextResponse(new Uint8Array(body), { headers: headers(`CEO-Summary-${stamp}.pdf`, "application/pdf") });
  }

  if (!(type in REPORTS)) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  const format = sp.format === "pdf" ? "pdf" : "xlsx";
  const report = await buildReport(u, type as ReportType, f);
  await audit(u.id, "report", type, "export", { format, filters: sp, rows: report.rows.length });
  const name = `${report.title.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}-${stamp}`;
  const body = format === "pdf" ? await toPdf(report) : await toXlsx(report);
  return new NextResponse(new Uint8Array(body), {
    headers: headers(`${name}.${format}`, format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  });
}
