import type { PrismaClient, Prisma } from "@prisma/client";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Lightweight format check — not full RFC. */
export function isValidEmailFormat(email: string): boolean {
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export type InviteEmailCheck =
  | { ok: true; email: string }
  | { ok: false; error: string; status: 400 };

export async function assertInviteableEmail(
  prisma: PrismaClient | Prisma.TransactionClient,
  rawEmail: string,
): Promise<InviteEmailCheck> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmailFormat(email)) {
    return { ok: false, error: "Invalid email", status: 400 };
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.role !== "CANDIDATE") {
    return { ok: false, error: "Email belongs to a non-candidate user", status: 400 };
  }
  return { ok: true, email };
}

export async function cancelPendingInvitations(
  prisma: PrismaClient | Prisma.TransactionClient,
  interviewId: string,
): Promise<void> {
  await prisma.invitation.updateMany({
    where: { interviewId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
}
