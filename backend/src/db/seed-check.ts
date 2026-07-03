import { SEED_HR_USER } from "../seed/hr-user";

type PrismaLike = {
  user: {
    findUnique: (args: {
      where: { email: string };
    }) => Promise<{ email: string; role: string } | null>;
  };
};

export type SeedCheckResult = {
  ok: boolean;
  email: string;
};

export async function checkHrSeedUser(
  client: PrismaLike
): Promise<SeedCheckResult> {
  const email = SEED_HR_USER.email;
  const user = await client.user.findUnique({ where: { email } });

  if (user?.role === "HR") {
    return { ok: true, email };
  }

  return { ok: false, email };
}
