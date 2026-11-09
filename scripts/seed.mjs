// Idempotent initialization. Inserts only what is missing; never updates or deletes existing rows.
import pg from "pg";
import crypto from "node:crypto";
import { loadEnv } from "./env.mjs";

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const pool = new pg.Pool({ connectionString: url, ssl: isLocal ? undefined : { rejectUnauthorized: false } });

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
}

const ORGS = [
  ["PAC", "Petromin Auto Care"],
  ["PCVC", "Petromin Commercial Vehicle Care"],
  ["DEX", "DEX"],
  ["CORP", "Corporate / Shared Services"],
];
// The 14 initial action plans are optional: a fresh system starts empty unless SEED_INITIAL_ACTIONS=1.
const SEED_ACTIONS = process.env.SEED_INITIAL_ACTIONS === "1";

// [point/task, suggested responsible, original timeline, organizations, objective area]
const INITIAL_ACTIONS = [
  ["Launch a joint marketing campaign in collaboration with Lulu Hypermarket.", "Hasan", "This month", ["PAC"], "customer_development"],
  ["Collaborate with local workshops to obtain SASO certification and ensure compliance with applicable standards.", "Moe", "2 Months", ["PAC"], "operational_efficiency"],
  ["Conduct a rental cost assessment for the 7 branches serving Aramco to evaluate their financial viability.", "Farhan – Network", "November", ["PAC"], "financial_performance"],
  ["Evaluate and propose the closure of 8 inactive or underperforming subleased branches.", "Farhan – Network", "2 Months", ["PAC"], "financial_performance"],
  ["Develop and implement immediate initiatives to increase customer footfall and improve branch activity.", "Nada", "Immediately", ["PAC"], "revenue_growth"],
  ["Introduce oil and filter service packages aligned with Petromin Express offerings.", "Brijesh", "Immediately", ["PAC"], "customer_development"],
  ["Implement a technical training and skill classification program for all manpower.", "Moe", "2 Months", ["PAC"], "employee_performance"],
  ["Launch a 60-day performance challenge with special incentives for branches achieving 100% of their targets.", "Regional Managers", "60 Days", ["PAC"], "employee_performance"],
  ["Develop and launch joint marketing campaigns with STC and Al Rajhi Bank.", "Hasan", "This Month", ["PAC"], "customer_development"],
  ["Finalize Stellantis oil and filter service packages, including pricing and implementation.", "To Be Assigned", "To Be Confirmed", ["PAC"], "customer_development"],
  ["Introduce ozone treatment services across branches at a fixed price of SAR 99.", "To Be Assigned", "To Be Confirmed", ["PAC"], "customer_development"],
  ["Complete and monitor employee performance evaluations across all branches.", "To Be Assigned", "Ongoing", ["PAC"], "employee_performance"],
  ["Prepare and submit daily operational performance reports.", "To Be Assigned", "Daily", ["PAC"], "operational_efficiency"],
  ["Develop a manpower replacement plan for PAC and PCVC.", "To Be Assigned", "To Be Confirmed", ["PAC", "PCVC"], "employee_performance"],
];

const ABDULLAH_PERMISSIONS = [
  "view_all_actions",
  "assign_any",
  "manage_objectives",
  "approve_completion",
  "export_reports",
];

const c = await pool.connect();
const log = [];
try {
  await c.query("BEGIN");
  for (const [code, name] of ORGS) {
    const r = await c.query("INSERT INTO organizations (code, name) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING", [code, name]);
    if (r.rowCount) log.push(`organization ${code} created`);
  }
  const orgIds = Object.fromEntries((await c.query("SELECT id, code FROM organizations")).rows.map((r) => [r.code, r.id]));

  // System Owner bootstrap — only when no System Owner exists yet.
  const owners = await c.query("SELECT id FROM users WHERE role = 'system_owner' LIMIT 1");
  if (!owners.rowCount && process.env.BOOTSTRAP_OWNER_EMAIL && process.env.BOOTSTRAP_OWNER_PASSWORD) {
    const r = await c.query(
      "INSERT INTO users (name, email, role, password_hash, must_change_password) VALUES ($1, lower($2), 'system_owner', $3, true) ON CONFLICT DO NOTHING RETURNING id",
      [process.env.BOOTSTRAP_OWNER_NAME || "System Owner", process.env.BOOTSTRAP_OWNER_EMAIL, hashPassword(process.env.BOOTSTRAP_OWNER_PASSWORD)],
    );
    if (r.rowCount) log.push(`system owner ${process.env.BOOTSTRAP_OWNER_EMAIL} created (must change password at first login)`);
  }

  // Abdullah Qadi — sees everything; receives the initial action plans when they are seeded.
  // Created only when ABDULLAH_QADI_EMAIL is given (otherwise the System Owner adds accounts by hand).
  let abdullah = (
    await c.query("SELECT id FROM users WHERE lower(name) = 'abdullah qadi' OR lower(email) = lower($1) LIMIT 1", [
      process.env.ABDULLAH_QADI_EMAIL || "",
    ])
  ).rows[0];
  if (!abdullah && process.env.ABDULLAH_QADI_EMAIL) {
    abdullah = (
      await c.query("INSERT INTO users (name, email, role) VALUES ('Abdullah Qadi', lower($1), 'director') RETURNING id", [
        process.env.ABDULLAH_QADI_EMAIL,
      ])
    ).rows[0];
    log.push("user Abdullah Qadi created (no password yet — set one from Administration › People & access)");
  }
  if (abdullah) {
    for (const p of ABDULLAH_PERMISSIONS) {
      await c.query("INSERT INTO user_permissions (user_id, permission) VALUES ($1,$2) ON CONFLICT DO NOTHING", [abdullah.id, p]);
    }
    for (const id of Object.values(orgIds)) {
      await c.query("INSERT INTO user_organizations (user_id, organization_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [abdullah.id, id]);
    }
  }
  if (SEED_ACTIONS && !abdullah) throw new Error("SEED_INITIAL_ACTIONS=1 needs ABDULLAH_QADI_EMAIL (the initial actions are assigned to him)");

  let created = 0;
  for (const [text, suggested, timeline, orgs, category] of SEED_ACTIONS ? INITIAL_ACTIONS : []) {
    const exists = await c.query("SELECT 1 FROM action_plans WHERE lower(trim(point_task)) = lower(trim($1)) LIMIT 1", [text]);
    if (exists.rowCount) continue;
    const id = (await c.query("SELECT nextval(pg_get_serial_sequence('action_plans','id')) AS id")).rows[0].id;
    const code = `BP-${String(id).padStart(4, "0")}`;
    await c.query(
      `INSERT INTO action_plans (id, code, point_task, owner_id, suggested_responsible, timeline_note, priority, status, category)
       VALUES ($1,$2,$3,$4,$5,$6,'medium','not_started',$7)`,
      [id, code, text, abdullah.id, suggested, timeline, category],
    );
    for (const o of orgs) {
      await c.query("INSERT INTO action_organizations (action_id, organization_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, orgIds[o]]);
    }
    await c.query(
      "INSERT INTO action_assignments (action_id, to_user_id, note) VALUES ($1,$2,'Initial configuration — assigned for distribution')",
      [id, abdullah.id],
    );
    await c.query("INSERT INTO audit_logs (entity_type, entity_id, action, changes) VALUES ('action', $1, 'seed_create', $2)", [
      String(id),
      JSON.stringify({ code, suggestedResponsible: suggested, timeline }),
    ]);
    created++;
  }
  log.push(SEED_ACTIONS ? `${created} initial action plan(s) created, ${INITIAL_ACTIONS.length - created} already present` : "no action plans seeded (system starts empty)");
  await c.query("COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
console.log(log.join("\n"));
