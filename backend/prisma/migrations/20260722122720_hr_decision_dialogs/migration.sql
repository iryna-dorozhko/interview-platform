-- CreateEnum
CREATE TYPE "InterviewDecisionType" AS ENUM ('ACCEPT', 'REJECT', 'ADDITIONAL_MEETING');

-- CreateEnum
CREATE TYPE "DialogMessageKind" AS ENUM ('USER', 'DECISION_LETTER');

-- CreateTable
CREATE TABLE "Dialog" (
    "id" TEXT NOT NULL,
    "hrUserId" TEXT NOT NULL,
    "candidateUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dialog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewDecision" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "finalReportId" TEXT NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "type" "InterviewDecisionType" NOT NULL,
    "letterBody" TEXT NOT NULL,
    "dialogMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DialogMessage" (
    "id" TEXT NOT NULL,
    "dialogId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" "DialogMessageKind" NOT NULL,
    "decisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DialogMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Dialog_hrUserId_updatedAt_idx" ON "Dialog"("hrUserId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Dialog_candidateUserId_updatedAt_idx" ON "Dialog"("candidateUserId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Dialog_hrUserId_candidateUserId_key" ON "Dialog"("hrUserId", "candidateUserId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewDecision_dialogMessageId_key" ON "InterviewDecision"("dialogMessageId");

-- CreateIndex
CREATE INDEX "InterviewDecision_interviewId_createdAt_idx" ON "InterviewDecision"("interviewId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "InterviewDecision_finalReportId_idx" ON "InterviewDecision"("finalReportId");

-- CreateIndex
CREATE INDEX "DialogMessage_dialogId_createdAt_idx" ON "DialogMessage"("dialogId", "createdAt");

-- CreateIndex
CREATE INDEX "DialogMessage_decisionId_idx" ON "DialogMessage"("decisionId");

-- AddForeignKey
ALTER TABLE "Dialog" ADD CONSTRAINT "Dialog_hrUserId_fkey" FOREIGN KEY ("hrUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dialog" ADD CONSTRAINT "Dialog_candidateUserId_fkey" FOREIGN KEY ("candidateUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewDecision" ADD CONSTRAINT "InterviewDecision_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewDecision" ADD CONSTRAINT "InterviewDecision_finalReportId_fkey" FOREIGN KEY ("finalReportId") REFERENCES "FinalReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewDecision" ADD CONSTRAINT "InterviewDecision_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewDecision" ADD CONSTRAINT "InterviewDecision_dialogMessageId_fkey" FOREIGN KEY ("dialogMessageId") REFERENCES "DialogMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialogMessage" ADD CONSTRAINT "DialogMessage_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "Dialog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialogMessage" ADD CONSTRAINT "DialogMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DialogMessage" ADD CONSTRAINT "DialogMessage_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "InterviewDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "VacancyMatchScore_candidateUserId_vacancyId_rankedForConfirmedA" RENAME TO "VacancyMatchScore_candidateUserId_vacancyId_rankedForConfir_key";
