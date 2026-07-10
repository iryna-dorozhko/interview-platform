-- Self-service questionnaires ("Моя анкета") may coexist with an active HR interview
-- for the same candidate; the partial unique index should only guard real interviews.
DROP INDEX IF EXISTS "Interview_candidateUserId_active_unique";

CREATE UNIQUE INDEX "Interview_candidateUserId_active_unique"
ON "Interview"("candidateUserId")
WHERE "candidateUserId" IS NOT NULL
  AND "status" IN ('AWAITING_CANDIDATE', 'READY', 'LIVE')
  AND "displayName" <> 'Моя анкета';
