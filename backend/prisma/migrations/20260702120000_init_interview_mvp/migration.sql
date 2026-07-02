-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('HR', 'CANDIDATE');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('DRAFT', 'AWAITING_CANDIDATE', 'READY', 'LIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "LiveAuthorType" AS ENUM ('HUMAN_HR', 'HUMAN_CANDIDATE', 'AGENT_ARBITER', 'AGENT_COMPANY', 'AGENT_CANDIDATE');

-- CreateEnum
CREATE TYPE "PrepHrAuthorType" AS ENUM ('HUMAN_HR', 'AGENT_COMPANY');

-- CreateEnum
CREATE TYPE "PrepCandidateAuthorType" AS ENUM ('HUMAN_CANDIDATE', 'AGENT_CANDIDATE');

-- CreateEnum
CREATE TYPE "Recommendation" AS ENUM ('HIRE', 'MAYBE', 'REJECT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "hrUserId" TEXT NOT NULL,
    "candidateUserId" TEXT,
    "joinCode" CHAR(6) NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyProfile" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "requirements" JSONB NOT NULL,
    "culture" JSONB NOT NULL,
    "expectations" JSONB NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateProfile" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "experience" JSONB NOT NULL,
    "skills" JSONB NOT NULL,
    "goals" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepSessionHr" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrepSessionHr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepMessageHr" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "authorType" "PrepHrAuthorType" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrepMessageHr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepSessionCandidate" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrepSessionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepMessageCandidate" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "authorType" "PrepCandidateAuthorType" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrepMessageCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "authorType" "LiveAuthorType" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalReport" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "reportMarkdown" TEXT NOT NULL,
    "recommendation" "Recommendation" NOT NULL,
    "matchScore" INTEGER NOT NULL,
    "strengths" JSONB NOT NULL DEFAULT '[]',
    "risks" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinalReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_joinCode_key" ON "Interview"("joinCode");

-- CreateIndex
CREATE INDEX "Interview_hrUserId_createdAt_idx" ON "Interview"("hrUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Interview_candidateUserId_idx" ON "Interview"("candidateUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_candidateUserId_active_unique"
ON "Interview"("candidateUserId")
WHERE "candidateUserId" IS NOT NULL
  AND "status" IN ('AWAITING_CANDIDATE', 'READY', 'LIVE');

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProfile_interviewId_key" ON "CompanyProfile"("interviewId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateProfile_interviewId_key" ON "CandidateProfile"("interviewId");

-- CreateIndex
CREATE UNIQUE INDEX "PrepSessionHr_interviewId_key" ON "PrepSessionHr"("interviewId");

-- CreateIndex
CREATE INDEX "PrepMessageHr_sessionId_createdAt_idx" ON "PrepMessageHr"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrepSessionCandidate_interviewId_key" ON "PrepSessionCandidate"("interviewId");

-- CreateIndex
CREATE INDEX "PrepMessageCandidate_sessionId_createdAt_idx" ON "PrepMessageCandidate"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveSession_interviewId_key" ON "LiveSession"("interviewId");

-- CreateIndex
CREATE INDEX "LiveMessage_sessionId_createdAt_idx" ON "LiveMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinalReport_interviewId_key" ON "FinalReport"("interviewId");

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_hrUserId_fkey" FOREIGN KEY ("hrUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_candidateUserId_fkey" FOREIGN KEY ("candidateUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyProfile" ADD CONSTRAINT "CompanyProfile_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateProfile" ADD CONSTRAINT "CandidateProfile_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepSessionHr" ADD CONSTRAINT "PrepSessionHr_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepMessageHr" ADD CONSTRAINT "PrepMessageHr_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PrepSessionHr"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepSessionCandidate" ADD CONSTRAINT "PrepSessionCandidate_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepMessageCandidate" ADD CONSTRAINT "PrepMessageCandidate_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PrepSessionCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveMessage" ADD CONSTRAINT "LiveMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalReport" ADD CONSTRAINT "FinalReport_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
