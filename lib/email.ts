import "server-only";

export function emailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export function appUrl(path = "/") {
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderEmail(opts: { recipientName: string; title: string; body: string; link?: string | null; cta?: string }) {
  const url = opts.link ? appUrl(opts.link) : null;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:#111318;padding:16px 24px;color:#ffffff;font-size:14px;letter-spacing:.04em"><strong style="color:#e11d2e">■</strong>&nbsp; BUSINESS PERFORMANCE · PAC | PCVC | DEX</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 12px;font-size:14px">Dear ${esc(opts.recipientName)},</p>
<h1 style="margin:0 0 12px;font-size:18px">${esc(opts.title)}</h1>
<p style="margin:0 0 20px;font-size:14px;line-height:1.55;white-space:pre-line">${esc(opts.body)}</p>
${url ? `<a href="${esc(url)}" style="display:inline-block;background:#c8102e;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">${esc(opts.cta ?? "Open in Business Performance")}</a>` : ""}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">You receive this message because of your role in an action plan. Manage notification preferences under Account settings.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `Dear ${opts.recipientName},\n\n${opts.title}\n\n${opts.body}${url ? `\n\n${url}` : ""}`;
  return { html, text };
}

/** Sends through the Resend HTTP API. Returns "sent" | "failed" | "disabled". */
export async function sendEmail(to: string, subject: string, content: { html: string; text: string }, idempotencyKey?: string) {
  if (!emailConfigured()) return "disabled" as const;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, html: content.html, text: content.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("Resend error", res.status, (await res.text()).slice(0, 300));
      return "failed" as const;
    }
    return "sent" as const;
  } catch (e) {
    console.error("Resend request failed", e);
    return "failed" as const;
  }
}
