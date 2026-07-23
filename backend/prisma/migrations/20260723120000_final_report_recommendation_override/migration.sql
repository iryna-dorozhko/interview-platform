-- CreateEnum
CREATE TYPE "RecommendationOverrideKind" AS ENUM (
  'culture_fit',
  'soft_skills',
  'critical_gap_ok',
  'red_flag',
  'other'
);

-- AlterTable
ALTER TABLE "FinalReport"
  ADD COLUMN "overrideKind" "RecommendationOverrideKind",
  ADD COLUMN "overrideReason" TEXT;
