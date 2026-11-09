// Applies pending SQL migrations (additive only). Never drops or resets data.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { loadEnv } from "./env.mjs";

loadEnv();
// Schema changes use the direct (unpooled) connection when the host provides one (e.g. Neon on Vercel).
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const pool = new pg.Pool({ connectionString: url, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
await migrate(drizzle(pool), { migrationsFolder: "./migrations" });
console.log("Migrations applied.");
await pool.end();
