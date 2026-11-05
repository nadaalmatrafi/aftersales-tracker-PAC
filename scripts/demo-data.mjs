// DEMO ONLY — creates clearly labelled demo departments and accounts for previews and end-to-end tests.
// Refuses to run unless the database name contains "demo" or "test". Never run against production.
import pg from "pg";
import crypto from "node:crypto";
import { loadEnv } from "./env.mjs";

loadEnv();
const url = process.env.DATABASE_URL ?? "";
const dbName = url.split("/").pop()?.split("?")[0] ?? "";
if (!/demo|test/i.test(dbName)) {
  console.error(`Refusing to load demo data into "${dbName}". Use a database whose name contains "demo" or "test".`);
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url });
const hash = (pw) => {
  const salt = crypto.randomBytes(16);
  return `scrypt$16384$8$1$${salt.toString("base64")}$${crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString("base64")}`;
};
const PW = process.env.DEMO_PASSWORD || "Demo-Pass-2026";
const c = await pool.connect();
try {
  await c.query("BEGIN");
  const org = Object.fromEntries((await c.query("SELECT code, id FROM organizations")).rows.map((r) => [r.code, r.id]));
  const depts = [["PAC", "Marketing"], ["PAC", "Technical & Training"], ["PAC", "Network Development"], ["PAC", "Operations"], ["PAC", "Products & Services"], ["PAC", "Finance"], ["PAC", "Human Resources"], ["PCVC", "Operations"], ["PCVC", "Human Resources"], ["DEX", "Operations"]];
  const d = {};
  for (const [o, n] of depts) {
    const r = await c.query("INSERT INTO departments (organization_id, name) VALUES ($1,$2) ON CONFLICT (organization_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id", [org[o], n]);
    d[`${o}:${n}`] = r.rows[0].id;
  }
  // [name, email, role, department, manager email, username, company (for company managers)]
  const users = [
    ["Demo CEO", "ceo@demo.local", "ceo", null, null, "ceo"],
    ["PAC Company Manager (Demo)", "pac.gm@demo.local", "company_manager", null, null, "pac.gm", "PAC"],
    ["PCVC Company Manager (Demo)", "pcvc.gm@demo.local", "company_manager", null, null, "pcvc.gm", "PCVC"],
    ["DEX Company Manager (Demo)", "dex.gm@demo.local", "company_manager", null, null, "dex.gm", "DEX"],
    ["Hasan (Demo)", "hasan@demo.local", "director", "PAC:Marketing", null, "hasan"],
    ["Moe (Demo)", "moe@demo.local", "director", "PAC:Technical & Training", null],
    ["Farhan (Demo)", "farhan@demo.local", "director", "PAC:Network Development", null, "farhan"],
    ["Nada (Demo)", "nada@demo.local", "director", "PAC:Operations", null],
    ["Brijesh (Demo)", "brijesh@demo.local", "director", "PAC:Products & Services", null],
    ["Finance Director (Demo)", "finance@demo.local", "director", "PAC:Finance", null],
    ["Network Manager (Demo)", "netmgr@demo.local", "manager", "PAC:Network Development", "farhan@demo.local"],
    ["Network Analyst (Demo)", "analyst@demo.local", "employee", "PAC:Network Development", "netmgr@demo.local"],
    ["PCVC Ops Director (Demo)", "pcvc@demo.local", "director", "PCVC:Operations", null],
  ];
  const ids = {};
  for (const [name, email, role, dept, mgr, username, company] of users) {
    const r = await c.query(
      `INSERT INTO users (name, email, role, department_id, manager_id, password_hash, username) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (lower(email)) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [name, email, role, dept ? d[dept] : null, mgr ? ids[mgr] : null, hash(PW), username ?? null],
    );
    ids[email] = r.rows[0].id;
    if (company) await c.query("INSERT INTO user_organizations (user_id, organization_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [r.rows[0].id, org[company]]);
  }
  for (const [k, email] of [["PAC:Marketing", "hasan@demo.local"], ["PAC:Technical & Training", "moe@demo.local"], ["PAC:Network Development", "farhan@demo.local"], ["PAC:Operations", "nada@demo.local"], ["PAC:Products & Services", "brijesh@demo.local"], ["PAC:Finance", "finance@demo.local"], ["PCVC:Operations", "pcvc@demo.local"]])
    await c.query("UPDATE departments SET director_id = $1 WHERE id = $2", [ids[email], d[k]]);
  await c.query("UPDATE users SET password_hash = $1, must_change_password = false WHERE role = 'system_owner' OR lower(name) = 'abdullah qadi'", [hash(PW)]);
  await c.query("COMMIT");
  console.log(`Demo departments and ${users.length} demo accounts ready (password: ${PW}).`);
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
