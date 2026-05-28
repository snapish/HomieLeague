import { Pool } from "pg";

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  pool = new Pool({
    connectionString,
    max: 10,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });

  return pool;
}
