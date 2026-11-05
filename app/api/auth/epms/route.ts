import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { createSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

/**
 * EPMS single sign-on. EPMS redirects to /api/auth/epms?token=<payload>.<signature>
 * payload = base64url(JSON {sub: EPMS employee id, email, exp: unix seconds, jti: unique id})
 * signature = base64url(HMAC-SHA256(payload, EPMS_SSO_SECRET)).
 * Only links to an EXISTING active account (by EPMS id, then email) — never creates duplicates.
 */
export async function GET(req: NextRequest) {
  const fail = () => NextResponse.redirect(new URL("/login?error=sso", req.url));
  const secret = process.env.EPMS_SSO_SECRET;
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const [payload, sig] = token.split(".");
  if (!secret || !payload || !sig) return fail();
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return fail();
  let claims: { sub?: string; email?: string; exp?: number; jti?: string };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return fail();
  }
  if (!claims.exp || claims.exp < Date.now() / 1000 || claims.exp > Date.now() / 1000 + 300 || !claims.jti) return fail();
  const replay = await db.execute(sql`SELECT 1 FROM audit_logs WHERE action = 'sso_login' AND changes->>'jti' = ${claims.jti} LIMIT 1`);
  if (replay.rows.length) return fail();
  const r = await db.execute(sql`SELECT id FROM users WHERE is_active AND ((${claims.sub ?? null}::text IS NOT NULL AND external_id = ${claims.sub ?? null}) OR lower(email) = lower(${claims.email ?? ""})) ORDER BY (external_id = ${claims.sub ?? ""}) DESC LIMIT 1`);
  const user = r.rows[0] as { id: string } | undefined;
  if (!user) return fail();
  await createSession(user.id);
  await audit(user.id, "auth", user.id, "sso_login", { jti: claims.jti, source: "EPMS" });
  return NextResponse.redirect(new URL("/", req.url));
}
