-- AlterTable
ALTER TABLE "CandidateProfile" ADD COLUMN "fullName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CandidateProfile" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CandidateProfile" ADD COLUMN "phone" TEXT;

ALTER TABLE "CandidateProfile" ALTER COLUMN "fullName" DROP DEFAULT;
ALTER TABLE "CandidateProfile" ALTER COLUMN "email" DROP DEFAULT;
