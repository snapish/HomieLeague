import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export function loadEnvironment(): void {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "apps/api/.env"),
    path.resolve(currentDir, "../../.env"),
    path.resolve(currentDir, "../../../apps/api/.env")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
      return;
    }
  }
}
