import type { Interview } from "@prisma/client";
import type { AuthUser } from "../auth/middleware";

const HR_STATUSES = ["AWAITING_CANDIDATE", "READY", "LIVE", "ENDED"] as const;
const CANDIDATE_STATUSES = ["READY", "LIVE", "ENDED"] as const;

export type RoomAccessResult =
  | { ok: true; readOnly: boolean }
  | { ok: false; error: string };

export function canAccessInterviewRoom(
  interview: Pick<Interview, "hrUserId" | "candidateUserId" | "status">,
  user: AuthUser,
): RoomAccessResult {
  if (user.role === "HR") {
    if (interview.hrUserId !== user.id) {
      return { ok: false, error: "Немає доступу" };
    }
    if (!HR_STATUSES.includes(interview.status as (typeof HR_STATUSES)[number])) {
      return { ok: false, error: "Немає доступу" };
    }
    return { ok: true, readOnly: interview.status === "ENDED" };
  }

  if (user.role === "CANDIDATE") {
    if (interview.candidateUserId !== user.id) {
      return { ok: false, error: "Немає доступу" };
    }
    if (!CANDIDATE_STATUSES.includes(interview.status as (typeof CANDIDATE_STATUSES)[number])) {
      return { ok: false, error: "Співбесіда ще не готова" };
    }
    return { ok: true, readOnly: interview.status === "ENDED" };
  }

  return { ok: false, error: "Немає доступу" };
}
