-- CreateTable
CREATE TABLE "InterviewEvalSnapshot" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "prepCandidateDurationMs" INTEGER,
    "prepVacancyDurationMs" INTEGER,
    "liveDurationMs" INTEGER,
    "autoRetryCount" INTEGER NOT NULL DEFAULT 0,
    "manualRetryCount" INTEGER NOT NULL DEFAULT 0,
    "hrMessageCount" INTEGER NOT NULL DEFAULT 0,
    "hrControlActionCount" INTEGER NOT NULL DEFAULT 0,
    "clarifyingQuestionCount" INTEGER NOT NULL DEFAULT 0,
    "agentMessageCount" INTEGER NOT NULL DEFAULT 0,
    "finalMatchScore" INTEGER,
    "arbiterRecommendation" "Recommendation",
    "hrDecisionType" "InterviewDecisionType",
    "hrAgreedWithArbiter" BOOLEAN,
    "reportCreatedAt" TIMESTAMP(3),
    "decisionUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewEvalSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InterviewEvalSnapshot_interviewId_key" ON "InterviewEvalSnapshot"("interviewId");

-- CreateIndex
CREATE INDEX "InterviewEvalSnapshot_reportCreatedAt_idx" ON "InterviewEvalSnapshot"("reportCreatedAt");

-- AddForeignKey
ALTER TABLE "InterviewEvalSnapshot" ADD CONSTRAINT "InterviewEvalSnapshot_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
