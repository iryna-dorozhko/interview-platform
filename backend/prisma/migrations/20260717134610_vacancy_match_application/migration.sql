-- CreateEnum
CREATE TYPE "VacancyApplicationStatus" AS ENUM ('PENDING', 'CONVERTED', 'WITHDRAWN', 'DECLINED_BY_HR');

-- CreateEnum
CREATE TYPE "VacancyOfferDecisionType" AS ENUM ('REJECTED');

-- CreateEnum
CREATE TYPE "HrNotificationType" AS ENUM ('VACANCY_APPLICATION');

-- CreateTable
CREATE TABLE "VacancyApplication" (
    "id" TEXT NOT NULL,
    "candidateUserId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "matchScore" INTEGER NOT NULL,
    "candidateSummary" TEXT NOT NULL,
    "status" "VacancyApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "interviewId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VacancyApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacancyOfferDecision" (
    "id" TEXT NOT NULL,
    "candidateUserId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "decision" "VacancyOfferDecisionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VacancyOfferDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrNotification" (
    "id" TEXT NOT NULL,
    "hrUserId" TEXT NOT NULL,
    "type" "HrNotificationType" NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacancyMatchScore" (
    "id" TEXT NOT NULL,
    "candidateUserId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "matchScore" INTEGER NOT NULL,
    "rankedForConfirmedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VacancyMatchScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VacancyApplication_interviewId_key" ON "VacancyApplication"("interviewId");

-- CreateIndex
CREATE INDEX "VacancyApplication_candidateUserId_status_idx" ON "VacancyApplication"("candidateUserId", "status");

-- CreateIndex
CREATE INDEX "VacancyApplication_vacancyId_createdAt_idx" ON "VacancyApplication"("vacancyId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "VacancyApplication_one_pending_per_candidate" ON "VacancyApplication"("candidateUserId") WHERE status = 'PENDING';

-- CreateIndex
CREATE INDEX "VacancyOfferDecision_candidateUserId_idx" ON "VacancyOfferDecision"("candidateUserId");

-- CreateIndex
CREATE UNIQUE INDEX "VacancyOfferDecision_candidateUserId_vacancyId_key" ON "VacancyOfferDecision"("candidateUserId", "vacancyId");

-- CreateIndex
CREATE INDEX "HrNotification_hrUserId_createdAt_idx" ON "HrNotification"("hrUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "VacancyMatchScore_candidateUserId_rankedForConfirmedAt_idx" ON "VacancyMatchScore"("candidateUserId", "rankedForConfirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VacancyMatchScore_candidateUserId_vacancyId_rankedForConfir_key" ON "VacancyMatchScore"("candidateUserId", "vacancyId", "rankedForConfirmedAt");

-- AddForeignKey
ALTER TABLE "VacancyApplication" ADD CONSTRAINT "VacancyApplication_candidateUserId_fkey" FOREIGN KEY ("candidateUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyApplication" ADD CONSTRAINT "VacancyApplication_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyApplication" ADD CONSTRAINT "VacancyApplication_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyOfferDecision" ADD CONSTRAINT "VacancyOfferDecision_candidateUserId_fkey" FOREIGN KEY ("candidateUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyOfferDecision" ADD CONSTRAINT "VacancyOfferDecision_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrNotification" ADD CONSTRAINT "HrNotification_hrUserId_fkey" FOREIGN KEY ("hrUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyMatchScore" ADD CONSTRAINT "VacancyMatchScore_candidateUserId_fkey" FOREIGN KEY ("candidateUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyMatchScore" ADD CONSTRAINT "VacancyMatchScore_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
