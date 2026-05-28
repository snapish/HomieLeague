import { Client } from "pg";
import { loadEnvironment } from "../config/loadEnv.js";

loadEnvironment();

async function createDatabaseIfMissing(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const targetUrl = new URL(connectionString);
  const dbName = targetUrl.pathname.replace(/^\//, "");
  if (!dbName) {
    throw new Error("DATABASE_URL must include a database name");
  }

  const adminUrl = new URL(connectionString);
  adminUrl.pathname = "/postgres";

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();

  const result = await client.query<{ exists: number }>(
    "SELECT 1 AS exists FROM pg_database WHERE datname = $1",
    [dbName]
  );

  if (result.rowCount === 0) {
    const escapedName = dbName.replace(/"/g, "");
    await client.query(`CREATE DATABASE "${escapedName}"`);
    console.log(`Created database: ${dbName}`);
  } else {
    console.log(`Database already exists: ${dbName}`);
  }

  await client.end();
}

createDatabaseIfMissing().catch((error) => {
  console.error("Database creation failed", error);
  process.exitCode = 1;
});
