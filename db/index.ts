import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __bpPool?: Pool };

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return new Pool({
    connectionString: url,
    max: 10,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
}

export const pool = globalForDb.__bpPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.__bpPool = pool;

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { schema };
