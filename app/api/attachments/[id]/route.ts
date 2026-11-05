import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { actionVisibility } from "@/lib/access";
import { objectiveVisibility } from "@/lib/objectives";

/** Attachments are only served after the same visibility check as their parent record. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = await db.execute(sql`
    SELECT f.filename, f.mime_type, f.data FROM attachments f
     WHERE f.id = ${id} AND f.deleted_at IS NULL AND (
       (f.action_id IS NOT NULL AND EXISTS (SELECT 1 FROM action_plans a WHERE a.id = f.action_id AND ${actionVisibility(u)}))
       OR (f.objective_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM objective_items oi JOIN objectives o ON o.id = oi.objective_id WHERE oi.id = f.objective_item_id AND ${objectiveVisibility(u)})))`);
  const f = r.rows[0] as { filename: string; mime_type: string; data: Buffer } | undefined;
  if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const inline = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/.test(f.mime_type);
  return new NextResponse(new Uint8Array(f.data), {
    headers: {
      "Content-Type": f.mime_type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(f.filename)}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
