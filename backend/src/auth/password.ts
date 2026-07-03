import crypto from "node:crypto";

export function hashPassword(plainPassword: string): string {
  return crypto.createHash("sha256").update(plainPassword).digest("hex");
}
