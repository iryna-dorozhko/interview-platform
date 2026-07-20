-- CreateEnum
CREATE TYPE "CandidateConfidence" AS ENUM ('CONFIRMED', 'INFERRED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "LiveMessage" ADD COLUMN     "candidateConfidence" "CandidateConfidence";
