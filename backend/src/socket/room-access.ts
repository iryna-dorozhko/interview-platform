import type { Interview } from "@prisma/client";
import type { AuthUser } from "../auth/middleware";

const JOINABLE_STATUSES = ["READY", "LIVE"] as const;

export function canAccessInterviewRoom(
  interview: Pick<Interview, "hrUserId" | "candidateUserId" | "status">,
  user: AuthUser,
): { ok: true } | { ok: false; error: string } {
  if (interview.status === "ENDED") {
    return { ok: false, error: "Співбесіда завершена" };
  }

  if (
    !JOINABLE_STATUSES.includes(
      interview.status as (typeof JOINABLE_STATUSES)[number],
    )
  ) {
    return { ok: false, error: "Співбесіда ще не готова" };
  }

  if (user.role === "HR") {
    if (interview.hrUserId !== user.id) {
      return { ok: false, error: "Немає доступу" };
    }
    return { ok: true };
  }

  if (user.role === "CANDIDATE") {
    if (interview.candidateUserId !== user.id) {
      return { ok: false, error: "Немає доступу" };
    }
    return { ok: true };
  }

  return { ok: false, error: "Немає доступу" };
}
