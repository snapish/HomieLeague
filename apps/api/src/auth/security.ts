import bcrypt from "bcrypt";
import crypto from "node:crypto";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, BCRYPT_ROUNDS);
}

export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainText, hash);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
