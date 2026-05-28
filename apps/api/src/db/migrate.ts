import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDbPool } from "./client.js";
import { loadEnvironment } from "../config/loadEnv.js";

loadEnvironment();

async function runMigration(): Promise<void> {
  const pool = getDbPool();
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(currentDir, "../../sql");
  const migrationFiles = (await readdir(migrationsDir))
    .filter((fileName) => /^\d+_.*\.sql$/i.test(fileName))
    .sort();

  for (const migrationFile of migrationFiles) {
    const migrationPath = path.resolve(migrationsDir, migrationFile);
    const sql = await readFile(migrationPath, "utf8");
    await pool.query(sql);
    console.log(`Migration applied: ${migrationFile}`);
  }

  await pool.end();
}

runMigration()
  .then(() => {
    console.log("All migrations applied");
  })
  .catch((error) => {
    console.error("Migration failed", error);
    process.exitCode = 1;
  });
