// End-to-end acceptance run against a DEMO database (see scripts/demo-data.mjs).
// Usage: BASE_URL=http://localhost:3000 SHOTS=<dir> node tests/e2e.mjs
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Playwright is pre-installed globally in the build environment; fall back to a local install if present.
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require("playwright");
} catch {
  pw = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOTS = process.env.SHOTS || "";
const PW = process.env.DEMO_PASSWORD || "Demo-Pass-2026";
const CRON = process.env.CRON_SECRET || "local-cron-secret";
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
/** Pages stream a loading skeleton first; wait until real content (an h1) is rendered after every navigation. */
function stabilise(page) {
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  const settle = async (res) => {
    await page.waitForSelector("h1", { timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    return res;
  };
  page.goto = async (...a) => settle(await goto(...a));
  page.reload = async (...a) => settle(await reload(...a));
  return page;
}
async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: Number(process.env.SCALE || 1) });
  const page = stabilise(await ctx.newPage());
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
  return { ctx, page };
}
const formWith = (page, buttonName, scope) => (scope ?? page).locator("form", { has: page.getByRole("button", { name: buttonName, exact: true }) }).first();
async function submit(page, form, buttonName) {
  // Server actions POST to the current URL; wait for the response (and any redirect) before continuing.
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST", { timeout: 30_000 }),
    form.getByRole("button", { name: buttonName, exact: true }).click(),
  ]);
  await page.waitForLoadState("networkidle");
}
async function actionIdByCode(page, code) {
  await page.goto(`${BASE}/actions?q=${code}`);
  await page.waitForSelector("table a[href^='/actions/']");
  const href = await page.locator(`table a[href^="/actions/"]`).first().getAttribute("href");
  return href.split("/").pop();
}
const seen = (page, text) => page.getByText(text).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
const shot = async (page, name, opts = {}) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: opts.full ?? false });
};

try {
  // ---------- Security boundaries (unauthenticated) ----------
  const anon = await browser.newContext();
  const ap = stabilise(await anon.newPage());
  await ap.goto(`${BASE}/`);
  check("Unauthenticated user is redirected to sign-in", ap.url().includes("/login"));
  const r401 = await anon.request.get(`${BASE}/api/reports/executive?format=xlsx`);
  check("Report export requires authentication", r401.status() === 401, `status ${r401.status()}`);
  const cronNo = await anon.request.get(`${BASE}/api/cron/reminders`);
  check("Reminder endpoint rejects missing secret", cronNo.status() === 401);
  await ap.goto(`${BASE}/login`);
  await ap.fill("input[name=email]", "abdullah.qadi@sandbox.local");
  await ap.fill("input[name=password]", "wrong-password-1");
  await ap.click("button[type=submit]");
  const bad = await ap.getByRole("alert").filter({ hasText: "Invalid email or password" }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check("Wrong password is rejected", bad);
  await shot(ap, "01-login");
  await anon.close();

  // ---------- Abdullah distributes an initial action ----------
  const ab = await session("abdullah.qadi@sandbox.local");
  let p = ab.page;
  await p.goto(`${BASE}/`);
  const total = await p.locator("text=Total action plans").locator("..").locator("..").innerText();
  check("Dashboard shows the 14 initial action plans", /plans\s*14\b/i.test(total), total.replace(/\s+/g, " "));

  const rentalId = await actionIdByCode(p, "BP-0003");
  await p.goto(`${BASE}/actions/${rentalId}`);
  await p.waitForSelector("section[aria-label='Current position']");
  const initialText = await p.locator("main").textContent();
  check("Initial action keeps original timeline and suggested owner", initialText.includes("Original timeline: November") && initialText.includes("Farhan – Network"), `timeline=${initialText.includes("Original timeline: November")} suggested=${initialText.includes("Farhan – Network")} url=${p.url()}`);
  await p.click("summary:has-text('Edit action plan')");
  const edit = formWith(p, "Save changes");
  await edit.locator("select[name=departmentId]").selectOption({ label: "PAC · Network Development" });
  await edit.locator("input[name=targetDate]").fill("2026-11-30");
  await edit.locator("select[name=priority]").selectOption("high");
  await submit(p, edit, "Save changes");
  check("Action edit saved", await seen(p, "Action plan saved."));

  const re = formWith(p, "Transfer responsibility");
  await re.locator("select[name=toUserId]").selectOption({ label: "Farhan (Demo) · Network Development" });
  await re.locator("input[name=note]").fill("Please lead the Aramco branch rental assessment.");
  await submit(p, re, "Transfer responsibility");
  await p.reload();
  const hist = await p.locator("section:has(h2:has-text('Ownership history'))").innerText();
  check("Reassignment preserves ownership history", hist.includes("Abdullah Qadi → Farhan (Demo)"), hist.replace(/\s+/g, " ").slice(0, 160));

  for (const [title, dept, who] of [
    ["Collect current rent contracts for the 7 Aramco branches", "PAC · Network Development", "Network Analyst (Demo)"],
    ["Finance to validate rental cost versus branch revenue", "PAC · Finance", "Finance Director (Demo)"],
    ["Prepare recommendation for the CEO", "PAC · Network Development", "Farhan (Demo)"],
  ]) {
    const f = formWith(p, "Add step");
    await f.locator("input[name=title]").fill(title);
    await f.locator("select[name=departmentId]").selectOption({ label: dept });
    await f.locator("select[name=assigneeId]").selectOption({ label: who });
    await submit(p, f, "Add step");
  }
  await p.reload();
  let pos = await p.locator("section[aria-label='Current position']").innerText();
  check("Cross-department workflow: currently with first step's assignee", pos.includes("Network Analyst (Demo)"), pos.replace(/\s+/g, " ").slice(0, 140));

  // Overdue calculation on another action
  const footId = await actionIdByCode(p, "BP-0005");
  await p.goto(`${BASE}/actions/${footId}`);
  await p.click("summary:has-text('Edit action plan')");
  const e2 = formWith(p, "Save changes");
  await e2.locator("select[name=departmentId]").selectOption({ label: "PAC · Operations" });
  await e2.locator("input[name=targetDate]").fill("2026-10-20");
  await submit(p, e2, "Save changes");
  await p.reload();
  check("Overdue status is derived automatically from the target date", (await p.locator("main").innerText()).includes("Overdue"));
  const up = formWith(p, "Upload");
  await up.locator("input[type=file]").setInputFiles({ name: "footfall-plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%demo evidence\n") });
  await submit(p, up, "Upload");
  await p.reload();
  const attHref = await p.locator('a[href^="/api/attachments/"]').first().getAttribute("href");
  check("Attachment uploaded and listed", !!attHref);
  const upd = formWith(p, "Post update");
  await upd.locator("textarea[name=note]").fill("Weekend promotion drafted; waiting for marketing budget confirmation.");
  await upd.locator("input[name=progress]").fill("25");
  await upd.locator("select[name=status]").selectOption("in_progress");
  await submit(p, upd, "Post update");
  check("Progress update saved", await seen(p, "Update recorded."));

  // ---------- Analyst completes the first step → hand-off to Finance ----------
  const an = await session("analyst@demo.local");
  await an.page.goto(`${BASE}/actions/${rentalId}`);
  check("Step assignee can open the action", (await an.page.locator("h1").innerText()).includes("rental cost assessment"));
  const step1 = an.page.locator("li[data-step]", { hasText: "Collect current rent contracts" }).first();
  const s1 = formWith(an.page, "Update step", step1);
  await s1.locator("select[name=status]").selectOption("done");
  await submit(an.page, s1, "Update step");
  await an.page.goto(`${BASE}/actions/${footId}`);
  const deniedText = await an.page.locator("body").textContent();
  check("Employee cannot open an unrelated action", deniedText.includes("Not found or not accessible") && !deniedText.includes("customer footfall"));
  await an.page.goto(`${BASE}/admin/users`);
  const admText = await an.page.locator("body").textContent();
  check("Employee cannot open administration", admText.includes("Not found or not accessible") && !admText.includes("Users & Permissions"));
  const exp = await an.ctx.request.get(`${BASE}/api/reports/executive?format=xlsx`);
  check("Employee cannot export reports (403)", exp.status() === 403);
  const att = await an.ctx.request.get(`${BASE}${attHref}`);
  check("Employee cannot download another action's attachment", att.status() === 404);
  await an.ctx.close();

  const fin = await session("finance@demo.local");
  await fin.page.goto(`${BASE}/notifications`);
  check("Next assignee receives a hand-off notification", (await fin.page.locator("main").innerText()).includes("Your turn: BP-0003"));
  await fin.page.goto(`${BASE}/actions/${rentalId}`);
  const step2 = fin.page.locator("li[data-step]", { hasText: "Finance to validate" }).first();
  let s2 = formWith(fin.page, "Update step", step2);
  await s2.locator("select[name=status]").selectOption("blocked");
  await s2.locator("input[name=note]").fill("Two lease contracts missing from Network");
  await submit(fin.page, s2, "Update step");

  const ceo = await session("ceo@demo.local");
  await ceo.page.goto(`${BASE}/`);
  const attn = await ceo.page.locator("section:has(h2:has-text('Requires attention'))").innerText();
  check("CEO dashboard shows who holds the work and the blocker", attn.includes("Finance Director (Demo)") && attn.includes("Two lease contracts missing"), attn.replace(/\s+/g, " ").slice(0, 200));
  await shot(ceo.page, "02-ceo-dashboard", { full: true });

  s2 = formWith(fin.page, "Update step", fin.page.locator("li[data-step]", { hasText: "Finance to validate" }).first());
  await fin.page.reload();
  s2 = formWith(fin.page, "Update step", fin.page.locator("li[data-step]", { hasText: "Finance to validate" }).first());
  await s2.locator("select[name=status]").selectOption("done");
  await submit(fin.page, s2, "Update step");
  await fin.ctx.close();

  const fa = await session("farhan@demo.local");
  await fa.page.goto(`${BASE}/actions/${rentalId}`);
  const s3 = formWith(fa.page, "Update step", fa.page.locator("li[data-step]", { hasText: "Prepare recommendation" }).first());
  await s3.locator("select[name=status]").selectOption("done");
  await submit(fa.page, s3, "Update step");
  const rc = formWith(fa.page, "Submit for approval");
  await rc.locator("textarea[name=note]").fill("Assessment complete: 2 of 7 branches exceed rent-to-revenue threshold. Recommendation attached.");
  await submit(fa.page, rc, "Submit for approval");
  await fa.page.reload();
  check("Owner submits for completion → Pending Approval", (await fa.page.locator("main").innerText()).includes("Pending Approval"));
  check("Owner cannot approve own completion", (await fa.page.getByRole("button", { name: "Approve", exact: true }).count()) === 0);
  await fa.ctx.close();

  await p.goto(`${BASE}/actions/${rentalId}`);
  const dec = formWith(p, "Approve");
  await dec.locator("input[name=note]").fill("Approved. Present at next CEO meeting.");
  await submit(p, dec, "Approve");
  await p.reload();
  const done = await p.locator("main").innerText();
  check("Authorized approver completes the action (100%)", done.includes("Completed") && done.includes("100%"));
  await shot(p, "03-action-detail", { full: true });

  // ---------- Meeting with decisions and carry-forward ----------
  await p.goto(`${BASE}/meetings`);
  const mf = formWith(p, "Create meeting");
  await mf.locator("input[name=meetingAt]").fill("2026-11-09T10:00");
  await mf.locator("input[name=location]").fill("Head Office – Board Room");
  await mf.locator("select[name=attendeeIds]").selectOption([{ label: "Demo CEO" }, { label: "Farhan (Demo) · Network Development" }, { label: "Nada (Demo) · Operations" }]);
  await mf.locator("textarea[name=agenda]").fill("1. Review open action plans\n2. Aramco branch rental results\n3. Footfall initiatives");
  await submit(p, mf, "Create meeting");
  await p.waitForURL(/\/meetings\/[0-9a-f-]{36}/);
  const meetingUrl = p.url();
  const dform = formWith(p, "Add decision");
  await dform.locator("textarea[name=decision]").fill("Prepare a branch-by-branch lease renegotiation plan for the 2 Aramco branches above threshold.");
  await submit(p, dform, "Add decision");
  const carried = await p.locator("section:has(h2:has-text('Carried forward'))").innerText();
  check("Unfinished actions carry forward into the meeting", carried.includes("BP-0005") && !carried.includes("BP-0003"));
  await p.getByRole("link", { name: "Create action" }).first().click();
  await p.waitForURL(/\/actions\/new/);
  const nf = formWith(p, "Create action plan");
  await nf.locator("select[name=ownerId]").selectOption({ label: "Farhan (Demo) · Network Development" });
  await nf.locator("input[name=targetDate]").fill("2026-12-15");
  await submit(p, nf, "Create action plan");
  await p.waitForURL(/\/actions\/\d+$/);
  check("Action generated from a meeting decision", (await p.locator("main").innerText()).includes("lease renegotiation"));
  const dupe = await (async () => {
    await p.goto(`${BASE}/actions/new`);
    const f = formWith(p, "Create action plan");
    await f.locator("textarea[name=pointTask]").fill("Develop a manpower replacement plan for PAC and PCVC.");
    await f.locator("input[name=orgIds]").first().check();
    await f.locator("select[name=ownerId]").selectOption({ label: "Abdullah Qadi" });
    await submit(p, f, "Create action plan");
    return p.locator("p[role=alert]").innerText();
  })();
  check("Duplicate action plans are blocked", dupe.includes("already exists"), dupe);
  await p.goto(meetingUrl);
  await shot(p, "04-meeting", { full: true });
  const ics = await ab.ctx.request.get(`${meetingUrl.replace("/meetings/", "/api/meetings/")}/ics`);
  check("Calendar invitation (.ics) is generated", ics.ok() && (await ics.text()).includes("BEGIN:VEVENT"));

  // ---------- Objectives checklist ----------
  await ceo.page.goto(`${BASE}/objectives?h=30`);
  const of = formWith(ceo.page, "Create objective");
  await of.locator("input[name=title]").fill("Activate customer footfall initiatives");
  await submit(ceo.page, of, "Create objective");
  const itf = formWith(ceo.page, "Add deliverable");
  await itf.locator("input[name=deliverable]").fill("Weekend promotion live in all Riyadh branches");
  await itf.locator("select[name=responsibleId]").selectOption({ label: "Nada (Demo)" });
  await submit(ceo.page, itf, "Add deliverable");
  const na = await session("nada@demo.local");
  await na.page.goto(`${BASE}/objectives?h=30`);
  const cf = formWith(na.page, "Mark complete");
  await cf.locator("input[name=evidenceNote]").fill("Promotion launched 05 Nov; photos in shared folder");
  await submit(na.page, cf, "Mark complete");
  await na.ctx.close();
  await ceo.page.reload();
  await submit(ceo.page, formWith(ceo.page, "Approve"), "Approve");
  await ceo.page.reload();
  check("Objective deliverable approved by manager", (await ceo.page.locator("main").innerText()).includes("Approved by Demo CEO"));
  await shot(ceo.page, "05-objectives", { full: true });

  // ---------- Reports ----------
  for (const [type, fmt, ct] of [["executive", "xlsx", "spreadsheetml"], ["overdue", "pdf", "pdf"], ["director", "xlsx", "spreadsheetml"], ["decisions", "pdf", "pdf"]]) {
    const r = await ceo.ctx.request.get(`${BASE}/api/reports/${type}?format=${fmt}`);
    const body = await r.body();
    check(`Report ${type}.${fmt} exports`, r.ok() && (r.headers()["content-type"] ?? "").includes(ct) && body.length > 1000, `${body.length} bytes`);
  }
  await ceo.page.goto(`${BASE}/reports?type=director`);
  await shot(ceo.page, "06-reports");
  await ceo.page.goto(`${BASE}/actions`);
  await shot(ceo.page, "07-action-list");

  // ---------- Reminders, persistence, logout ----------
  const cron = await ceo.ctx.request.get(`${BASE}/api/cron/reminders`, { headers: { Authorization: `Bearer ${CRON}` } });
  const cronBody = await cron.json();
  const cron2 = await (await ceo.ctx.request.get(`${BASE}/api/cron/reminders`, { headers: { Authorization: `Bearer ${CRON}` } })).json();
  check("Reminder sweep runs (overdue reminder issued)", cron.ok() && cronBody.overdue >= 1, JSON.stringify(cronBody));
  await p.goto(`${BASE}/notifications`);
  await p.waitForSelector("h1:has-text('Notifications')");
  const overdueCount = await p.locator("main a", { hasText: "Overdue: BP-0005" }).count();
  const seenLinks = (await p.locator("main a").allTextContents()).slice(0, 6).join(" | ");
  check("Reminders are not duplicated on re-run", overdueCount === 1, `run2 ${JSON.stringify(cron2)} · ${overdueCount} notification(s) · url ${p.url()} · links: ${seenLinks}`);

  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: Number(process.env.SCALE || 1), storageState: await ceo.ctx.storageState() });
  const mp = stabilise(await mobile.newPage());
  await mp.goto(`${BASE}/`);
  await mp.waitForSelector("text=Requires attention");
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("Mobile 375px: no horizontal page scroll", !overflow);
  await shot(mp, "08-mobile-dashboard");
  await mobile.close();

  await p.goto(`${BASE}/actions/${rentalId}`);
  check("Data persists across sessions", (await p.locator("main").innerText()).includes("Completed"));
  await p.click("button:has-text('Sign out')");
  await p.waitForURL(/\/login/);
  await p.goto(`${BASE}/`);
  check("Sign-out ends the session", p.url().includes("/login"));
  await ab.ctx.close();
  await ceo.ctx.close();
} catch (e) {
  check("Unexpected error", false, e.stack?.split("\n").slice(0, 3).join(" | "));
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
