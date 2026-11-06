// End-to-end acceptance run against a DEMO database (see scripts/demo-data.mjs).
// Usage: BASE_URL=http://localhost:3000 DATABASE_URL=<demo db> SHOTS=<dir> [SCALE=2] node tests/e2e.mjs
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

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
const SCALE = Number(process.env.SCALE || 1);
const PW = process.env.DEMO_PASSWORD || "Demo-Pass-2026";
const CRON = process.env.CRON_SECRET || "local-cron-secret";
const DB_URL = process.env.DATABASE_URL || "postgres://bp:bp_local_dev@localhost:5432/business_performance_demo";
if (!/demo|test/i.test(DB_URL)) throw new Error("e2e must run against a demo/test database");
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
async function session(login, viewport = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: SCALE });
  const page = stabilise(await ctx.newPage());
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=email]", login);
  await page.fill("input[name=password]", PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
  await page.waitForSelector("h1");
  return { ctx, page };
}
const formWith = (page, buttonName, scope) => (scope ?? page).locator("form", { has: page.getByRole("button", { name: buttonName, exact: true }) }).first();
async function submit(page, form, buttonName) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST", { timeout: 30_000 }),
    form.getByRole("button", { name: buttonName, exact: true }).click(),
  ]);
  await page.waitForLoadState("networkidle");
}
const seen = (page, text) => page.getByText(text).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
async function actionIdByCode(page, code) {
  const num = Number(code.split("-")[1]);
  return String(num);
}
const shot = async (page, name, opts = {}) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: opts.full ?? false });
};
const main = async (page) => (await page.locator("main").textContent()) ?? "";
const db = new pg.Pool({ connectionString: DB_URL });

try {
  // ---------- Security boundaries (unauthenticated) ----------
  const anon = await browser.newContext({ deviceScaleFactor: SCALE });
  const ap = stabilise(await anon.newPage());
  await ap.goto(`${BASE}/`);
  check("Unauthenticated user is redirected to sign-in", ap.url().includes("/login"));
  check("Sign-in page shows the Petromin Auto Care logo", await ap.locator('img[alt="Petromin Auto Care"]').isVisible());
  const r401 = await anon.request.get(`${BASE}/api/reports/executive?format=xlsx`);
  check("Report export requires authentication", r401.status() === 401, `status ${r401.status()}`);
  const cronNo = await anon.request.get(`${BASE}/api/cron/reminders`);
  check("Reminder endpoint rejects missing secret", cronNo.status() === 401);
  await ap.fill("input[name=email]", "abdullah.qadi@sandbox.local");
  await ap.fill("input[name=password]", "wrong-password-1");
  await ap.click("button[type=submit]");
  const bad = await ap.getByRole("alert").filter({ hasText: "Invalid email, username or password" }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check("Wrong password is rejected", bad);
  await shot(ap, "01-login");
  for (const gone of ["/meetings", "/objectives"]) {
    const r = await anon.request.get(`${BASE}${gone}`, { maxRedirects: 0 });
    check(`Removed page ${gone} no longer exists`, r.status() === 404, `status ${r.status()}`);
  }
  await anon.close();

  // ---------- Abdullah distributes an initial action ----------
  const ab = await session("abdullah.qadi@sandbox.local");
  let p = ab.page;
  check("Landing page is My Work", (await p.locator("h1").innerText()) === "My Work");
  await p.goto(`${BASE}/overview`);
  check("Dashboard is named Overview", (await p.locator("h1").innerText()) === "Overview");
  const total = await p.locator("text=Total action plans").locator("..").locator("..").innerText();
  check("Overview shows the 14 initial action plans", /plans\s*14\b/i.test(total), total.replace(/\s+/g, " "));

  await p.goto(`${BASE}/actions`);
  check("Action Plans has no search box", (await p.locator("input[name=q]").count()) === 0);
  const abPeople = await p.locator("select[name=person] option").allTextContents();
  check("Abdullah's people filter lists everyone", abPeople.length > 10 && abPeople.some((t) => t.includes("Network Analyst")), `${abPeople.length - 1} people`);

  const rentalId = await actionIdByCode(p, "BP-0003");
  await p.goto(`${BASE}/actions/${rentalId}`);
  const initialText = await main(p);
  check("Initial action keeps original timeline and suggested owner", initialText.includes("Original timeline: November") && initialText.includes("Farhan – Network"));
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
  check("Reassignment preserves ownership history", hist.includes("Abdullah Qadi → Farhan (Demo)"));

  for (const [title, dept, who] of [
    ["Collect current rent contracts for the 7 Aramco branches", "PAC · Network Development", "Network Analyst (Demo)"],
    ["Finance to validate rental cost versus branch revenue", "PAC · Finance", "Finance Director (Demo)"],
    ["Prepare recommendation for the CEO", "PAC · Network Development", "Farhan (Demo)"],
  ]) {
    const f = formWith(p, "Add update");
    await f.locator("input[name=title]").fill(title);
    await f.locator("select[name=departmentId]").selectOption({ label: dept });
    await f.locator("select[name=assigneeId]").selectOption({ label: who });
    await submit(p, f, "Add update");
  }
  await p.reload();
  let pos = await p.locator("section[aria-label='Current position']").innerText();
  check("Cross-department workflow: currently with first step's assignee", pos.includes("Network Analyst (Demo)"));

  const footId = await actionIdByCode(p, "BP-0005");
  await p.goto(`${BASE}/actions/${footId}`);
  await p.click("summary:has-text('Edit action plan')");
  const e2 = formWith(p, "Save changes");
  await e2.locator("select[name=departmentId]").selectOption({ label: "PAC · Operations" });
  await e2.locator("input[name=targetDate]").fill("2026-10-20");
  await submit(p, e2, "Save changes");
  await p.reload();
  check("Overdue status is derived automatically from the target date", (await main(p)).includes("Overdue"));
  const up = formWith(p, "Upload");
  await up.locator("input[type=file]").setInputFiles({ name: "footfall-plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%demo evidence\n") });
  await submit(p, up, "Upload");
  await p.reload();
  const attHref = await p.locator('a[href^="/api/attachments/"]').first().getAttribute("href");
  check("Attachment uploaded and listed", !!attHref);
  check("Action page has no separate 'Post update' or approvals section", (await p.getByRole("button", { name: "Post update" }).count()) === 0 && (await p.locator("h2", { hasText: "Approvals" }).count()) === 0);
  const upd = formWith(p, "Add update");
  await upd.locator("input[name=title]").fill("Weekend promotion — confirm marketing budget");
  await upd.locator("select[name=departmentId]").selectOption({ label: "PAC · Operations" });
  await upd.locator("select[name=assigneeId]").selectOption({ label: "Nada (Demo)" });
  await submit(p, upd, "Add update");
  check("Update (stage, department, person) added", await seen(p, "Update added."));

  // ---------- Employee: login by username is not set for analyst; email works; step hand-off ----------
  const an = await session("analyst@demo.local");
  check("Employee does not see the people filter", await (async () => { await an.page.goto(`${BASE}/actions`); return (await an.page.locator("select[name=person]").count()) === 0; })());
  await an.page.goto(`${BASE}/`);
  check("Employee's My Work shows the step waiting on them", (await main(an.page)).includes("Collect current rent contracts"));
  await an.page.goto(`${BASE}/actions/${rentalId}`);
  const s1 = formWith(an.page, "Save", an.page.locator("li[data-step]", { hasText: "Collect current rent contracts" }).first());
  await s1.locator("select[name=status]").selectOption("done");
  await submit(an.page, s1, "Save");
  await an.page.goto(`${BASE}/actions/${footId}`);
  const deniedText = await an.page.locator("body").textContent();
  check("Employee cannot open an unrelated action", deniedText.includes("Not found or not accessible") && !deniedText.includes("customer footfall"));
  await an.page.goto(`${BASE}/admin/users`);
  check("Employee cannot open administration", (await an.page.locator("body").textContent()).includes("Not found or not accessible"));
  const exp = await an.ctx.request.get(`${BASE}/api/reports/executive?format=xlsx`);
  check("Employee cannot export reports (403)", exp.status() === 403);
  const att = await an.ctx.request.get(`${BASE}${attHref}`);
  check("Employee cannot download another action's attachment", att.status() === 404);
  await an.ctx.close();

  // ---------- Finance blocks, then goes on leave; the delegate continues ----------
  const fin = await session("finance@demo.local");
  await fin.page.goto(`${BASE}/notifications`);
  check("Next assignee receives a hand-off notification", (await main(fin.page)).includes("Your turn: BP-0003"));
  await fin.page.goto(`${BASE}/actions/${rentalId}`);
  let s2 = formWith(fin.page, "Save", fin.page.locator("li[data-step]", { hasText: "Finance to validate" }).first());
  await s2.locator("select[name=status]").selectOption("blocked");
  await s2.locator("input[name=note]").fill("Two lease contracts missing from Network");
  await submit(fin.page, s2, "Save");

  const ceo = await session("ceo@demo.local");
  await ceo.page.goto(`${BASE}/overview`);
  const attn = await ceo.page.locator("section:has(h2:has-text('Requires attention'))").innerText();
  check("Overview shows who holds the work and the blocker", attn.includes("Finance Director (Demo)") && attn.includes("Two lease contracts missing"));
  await ceo.page.goto(`${BASE}/actions`);
  const ceoPeople = await ceo.page.locator("select[name=person] option").allTextContents();
  check("CEO's people filter lists the company managers", ceoPeople.length === 4 && ceoPeople.every((t, i) => i === 0 || t.includes("Company Manager")), ceoPeople.slice(1).join(" | "));
  check("CEO's filter is labelled Company managers", (await ceo.page.locator("label:has(select[name=person]) .label").innerText()) === "Company managers");
  await ceo.page.locator("select[name=person]").selectOption({ label: ceoPeople.find((t) => t.startsWith("PCVC Company Manager")) });
  await ceo.page.getByRole("button", { name: "Apply" }).click();
  await ceo.page.waitForURL(/person=/);
  await ceo.page.waitForSelector("h1");
  const pcvcRows = await ceo.page.locator("table tbody tr").count();
  const pcvcText = await main(ceo.page);
  check("Selecting a company manager shows that company's actions", pcvcRows === 1 && pcvcText.includes("BP-0014"), `${pcvcRows} row(s)`);

  // Leave: Finance Director delegates to the Network Manager
  await fin.page.goto(`${BASE}/account`);
  const lf = formWith(fin.page, "Save leave");
  const t0 = new Date(), t1 = new Date(Date.now() + 3 * 86400000);
  const iso = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  await lf.locator("input[name=startDate]").fill(iso(t0));
  await lf.locator("input[name=endDate]").fill(iso(t1));
  await lf.locator("select[name=delegateId]").selectOption({ label: "Network Manager (Demo) · Network Development" });
  await submit(fin.page, lf, "Save leave");
  check("Leave and delegate saved", await seen(fin.page, "Leave saved."));
  await fin.ctx.close();

  const nm = await session("netmgr@demo.local");
  await nm.page.goto(`${BASE}/actions/${rentalId}`);
  pos = await nm.page.locator("section[aria-label='Current position']").innerText();
  check("Delegate appears as current holder, covering for the person on leave", pos.includes("Network Manager (Demo)") && pos.includes("Covering for Finance Director (Demo)"), pos.replace(/\s+/g, " ").slice(0, 120));
  s2 = formWith(nm.page, "Save", nm.page.locator("li[data-step]", { hasText: "Finance to validate" }).first());
  await s2.locator("select[name=status]").selectOption("done");
  await submit(nm.page, s2, "Save");
  await nm.page.reload();
  check("Delegate can complete the absent person's step", (await nm.page.locator("li[data-step]", { hasText: "Finance to validate" }).first().innerText()).includes("Done"));
  await nm.ctx.close();

  // ---------- Owner completes directly (no approvals in this system) ----------
  const fa = await session("farhan");
  check("Sign-in with a username works", (await fa.page.locator("h1").innerText()) === "My Work");
  await fa.page.goto(`${BASE}/actions/${rentalId}`);
  const s3 = formWith(fa.page, "Save", fa.page.locator("li[data-step]", { hasText: "Prepare recommendation" }).first());
  await s3.locator("select[name=status]").selectOption("done");
  await submit(fa.page, s3, "Save");
  fa.page.once("dialog", (d) => d.accept());
  const rc = formWith(fa.page, "Mark as completed");
  await rc.locator("input[name=note]").fill("Assessment complete: 2 of 7 branches exceed rent-to-revenue threshold.");
  await submit(fa.page, rc, "Mark as completed");
  await fa.page.reload();
  const doneText = await main(fa.page);
  check("Owner completes the action directly — no approval step (100%)", doneText.includes("Completed") && doneText.includes("100%") && !doneText.includes("Pending Approval"));
  await shot(fa.page, "05-action-detail", { full: true });
  await fa.ctx.close();

  const pcvc = await session("pcvc.gm@demo.local");
  await pcvc.page.goto(`${BASE}/actions/${rentalId}`);
  check("PCVC company manager cannot open a PAC-only action", (await pcvc.page.locator("body").textContent()).includes("Not found or not accessible"));
  await pcvc.ctx.close();

  const pac = await session("pac.gm");
  await pac.page.goto(`${BASE}/`);
  check("My Work has no approvals section", (await pac.page.locator("h2", { hasText: "Approvals" }).count()) === 0);
  await pac.page.goto(`${BASE}/actions`);
  const pacPeople = await pac.page.locator("select[name=person] option").allTextContents();
  check("Company manager's filter lists their department directors", pacPeople.some((t) => t.startsWith("Farhan (Demo)")) && !pacPeople.some((t) => t.startsWith("PCVC Ops Director")), `${pacPeople.length - 1} directors`);
  await pac.page.goto(`${BASE}/actions/${rentalId}`);
  check("PAC company manager can open PAC actions", (await main(pac.page)).includes("rental cost assessment"));
  await pac.ctx.close();

  // ---------- Request update ----------
  await ceo.page.goto(`${BASE}/actions/${footId}`);
  const ru = formWith(ceo.page, "Request update");
  await ru.locator("input[name=message]").fill("Where are we on the weekend promotion?");
  await submit(ceo.page, ru, "Request update");
  check("CEO requests an update from the current holder", await seen(ceo.page, "Update requested from Nada (Demo)."));
  const nadaN = await session("nada@demo.local");
  await nadaN.page.goto(`${BASE}/notifications`);
  check("Holder receives the update request", (await main(nadaN.page)).includes("Update requested: BP-0005"));
  await nadaN.ctx.close();

  // ---------- Duplicates ----------
  await p.goto(`${BASE}/actions/new`);
  const nf = formWith(p, "Create action plan");
  await nf.locator("textarea[name=pointTask]").fill("Develop a manpower replacement plan for PAC and PCVC.");
  await nf.locator("input[name=orgIds]").first().check();
  await nf.locator("select[name=ownerId]").selectOption({ label: "Abdullah Qadi" });
  await submit(p, nf, "Create action plan");
  const dupe = await p.locator("p[role=alert]").innerText();
  check("Duplicate action plans are blocked", dupe.includes("already exists"), dupe);

  // ---------- 30/60/90 objectives inside Overview ----------
  await ceo.page.goto(`${BASE}/overview`);
  check("Overview has the small 30/60/90 card", await ceo.page.getByText("30 / 60 / 90-day objectives").isVisible());
  await ceo.page.getByRole("link", { name: "Open checklist" }).click();
  await ceo.page.waitForSelector("#objectives");
  await ceo.page.click("summary:has-text('New 30-day objective')");
  const of = formWith(ceo.page, "Create objective");
  await of.locator("input[name=title]").fill("Activate customer footfall initiatives");
  await submit(ceo.page, of, "Create objective");
  await ceo.page.click("#objectives summary:has-text('Add deliverable')");
  const itf = formWith(ceo.page, "Add deliverable");
  await itf.locator("input[name=deliverable]").fill("Weekend promotion live in all Riyadh branches");
  await itf.locator("select[name=responsibleId]").selectOption({ label: "Nada (Demo)" });
  await submit(ceo.page, itf, "Add deliverable");
  const na = await session("nada@demo.local");
  await na.page.goto(`${BASE}/overview?obj=30`);
  const cf = formWith(na.page, "Mark complete");
  await cf.locator("input[name=evidenceNote]").fill("Promotion launched 05 Nov; photos in shared folder");
  await submit(na.page, cf, "Mark complete");
  await na.ctx.close();
  await ceo.page.reload();
  const objText = await main(ceo.page);
  check("Deliverable counts as done straight away (no approval)", objText.includes("Done · Nada (Demo)") && (await ceo.page.getByRole("button", { name: "Approve", exact: true }).count()) === 0);
  await shot(ceo.page, "03-overview-objectives", { full: true });

  // ---------- Reports ----------
  for (const [type, fmt, ct] of [["executive", "xlsx", "spreadsheetml"], ["overdue", "pdf", "pdf"], ["director", "xlsx", "spreadsheetml"], ["escalations", "pdf", "pdf"], ["ceo-summary", "pdf", "pdf"]]) {
    const r = await ceo.ctx.request.get(`${BASE}/api/reports/${type}?format=${fmt}`);
    const body = await r.body();
    check(`Report ${type}.${fmt} exports`, r.ok() && (r.headers()["content-type"] ?? "").includes(ct) && body.length > 1000, `${body.length} bytes`);
  }
  const meetingReport = await ceo.ctx.request.get(`${BASE}/api/reports/meeting?format=pdf`);
  check("Meeting report removed", meetingReport.status() === 404);

  // ---------- Multi-select status filter ----------
  await ceo.page.goto(`${BASE}/overview?status=overdue&status=completed`);
  const multi = await ceo.page.locator("text=Total action plans").locator("..").locator("..").innerText();
  check("Status filter accepts several statuses at once (overdue + completed)", /plans\s*2\b/i.test(multi), multi.replace(/\s+/g, " "));
  const opts = await ceo.page.locator("input[type=checkbox][name=status]").evaluateAll((els) => els.map((e) => e.value));
  check("Status options no longer include Pending Approval", opts.length === 6 && !opts.includes("pending_approval"), opts.join(","));

  // ---------- Reminders and the no-progress alert ----------
  await db.query("UPDATE action_plans SET last_update_at = NULL, created_at = now() - interval '5 days' WHERE code = 'BP-0012'");
  const cron = await ceo.ctx.request.get(`${BASE}/api/cron/reminders`, { headers: { Authorization: `Bearer ${CRON}` } });
  const cronBody = await cron.json();
  const cron2 = await (await ceo.ctx.request.get(`${BASE}/api/cron/reminders`, { headers: { Authorization: `Bearer ${CRON}` } })).json();
  check("Reminder sweep runs (overdue + no-progress alerts)", cron.ok() && cronBody.overdue >= 1 && cronBody.stale >= 1, JSON.stringify(cronBody));
  await ceo.page.goto(`${BASE}/notifications`);
  const staleCount = await ceo.page.locator("main a", { hasText: "BP-0012" }).count();
  check("No-progress alert reaches management once (no duplicates on re-run)", staleCount === 1, `run2 ${JSON.stringify(cron2)} · ${staleCount}`);
  await p.goto(`${BASE}/notifications`);
  check("Overdue reminder not duplicated", (await p.locator("main a", { hasText: "Overdue: BP-0005" }).count()) === 1);

  // ---------- Screenshots and layout ----------
  await ceo.page.goto(`${BASE}/overview`);
  await shot(ceo.page, "02-overview", { full: true });
  await ceo.page.goto(`${BASE}/actions`);
  await shot(ceo.page, "04-action-list");
  const myw = await session("abdullah.qadi@sandbox.local");
  await shot(myw.page, "00-my-work", { full: true });
  await myw.ctx.close();
  for (const url of ["/", "/overview", "/actions"]) {
    const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: SCALE, storageState: await ceo.ctx.storageState() });
    const mp = stabilise(await mobile.newPage());
    await mp.goto(`${BASE}${url}`);
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`Mobile 375px ${url}: no horizontal page scroll`, !overflow);
    if (url === "/overview") await shot(mp, "06-mobile-overview");
    await mobile.close();
  }

  await p.goto(`${BASE}/actions/${rentalId}`);
  check("Data persists across sessions", (await main(p)).includes("Completed"));
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
  await db.end();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
