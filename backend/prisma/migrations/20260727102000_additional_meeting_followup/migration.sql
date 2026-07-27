-- CreateEnum
CREATE TYPE "InterviewKind" AS ENUM ('STANDARD', 'ADDITIONAL_MEETING');

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN "kind" "InterviewKind" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN "followUpFromFinalReportId" TEXT;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_followUpFromFinalReportId_fkey" FOREIGN KEY ("followUpFromFinalReportId") REFERENCES "FinalReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
