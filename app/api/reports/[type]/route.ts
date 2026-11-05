import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, canExport } from "@/lib/auth";
import { parseFilters } from "@/lib/queries";
import { buildReport, REPORTS, toPdf, toXlsx, type ReportType } from "@/lib/reports";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest, ctx: { params: Promise<{ type: string }> }) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canExport(u)) return NextResponse.json({ error: "Export not permitted for your role" }, { status: 403 });
  const { type } = await ctx.params;
  if (!(type in REPORTS)) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const format = sp.format === "pdf" ? "pdf" : "xlsx";
  const meetingId = /^[0-9a-f-]{36}$/i.test(sp.meeting ?? "") ? sp.meeting : undefined;
  const f = parseFilters(sp);
  if (type === "meeting") delete f.meeting;
  const report = await buildReport(u, type as ReportType, f, { meetingId });
  await audit(u.id, "report", type, "export", { format, filters: sp, rows: report.rows.length });
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${report.title.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}-${stamp}`;
  const body = format === "pdf" ? await toPdf(report) : await toXlsx(report);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}.${format}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
