-- AlterTable
ALTER TABLE "VacancyMatchScore" ADD COLUMN "breakdown" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "VacancyMatchScore" ADD COLUMN "rankedForVacancyConfirmedAt" TIMESTAMP(3);

-- Backfill from confirmed company profiles; fallback to rankedForConfirmedAt
UPDATE "VacancyMatchScore" AS vms
SET "rankedForVacancyConfirmedAt" = COALESCE(cp."confirmedAt", vms."rankedForConfirmedAt")
FROM "Vacancy" v
LEFT JOIN "CompanyProfile" cp ON cp."vacancyId" = v.id
WHERE v.id = vms."vacancyId";

ALTER TABLE "VacancyMatchScore" ALTER COLUMN "rankedForVacancyConfirmedAt" SET NOT NULL;

-- DropIndex / unique (actual name from 20260717134610 migration — PG truncates long identifiers)
DROP INDEX IF EXISTS "VacancyMatchScore_candidateUserId_vacancyId_rankedForConfir_key";
CREATE UNIQUE INDEX "VacancyMatchScore_candidateUserId_vacancyId_rankedForConfirmedAt_rankedForVacancyConfirmedAt_key"
  ON "VacancyMatchScore"("candidateUserId", "vacancyId", "rankedForConfirmedAt", "rankedForVacancyConfirmedAt");

-- AlterTable applications
ALTER TABLE "VacancyApplication" ADD COLUMN "matchBreakdown" JSONB NOT NULL DEFAULT '{}';
