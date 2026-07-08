-- CreateEnum
CREATE TYPE "VacancyStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- DropForeignKey
ALTER TABLE "CompanyProfile" DROP CONSTRAINT "CompanyProfile_interviewId_fkey";

-- DropForeignKey
ALTER TABLE "PrepSessionHr" DROP CONSTRAINT "PrepSessionHr_interviewId_fkey";

-- DropIndex
DROP INDEX "CompanyProfile_interviewId_key";

-- DropIndex
DROP INDEX "PrepSessionHr_interviewId_key";

-- AlterTable
ALTER TABLE "CompanyProfile" DROP COLUMN "interviewId",
ADD COLUMN     "vacancyId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "displayName" TEXT NOT NULL,
ADD COLUMN     "vacancyId" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'AWAITING_CANDIDATE';

-- AlterTable
ALTER TABLE "PrepSessionHr" DROP COLUMN "interviewId",
ADD COLUMN     "vacancyId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Vacancy" (
    "id" TEXT NOT NULL,
    "hrUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "VacancyStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vacancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vacancy_hrUserId_createdAt_idx" ON "Vacancy"("hrUserId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProfile_vacancyId_key" ON "CompanyProfile"("vacancyId");

-- CreateIndex
CREATE INDEX "Interview_vacancyId_idx" ON "Interview"("vacancyId");

-- CreateIndex
CREATE UNIQUE INDEX "PrepSessionHr_vacancyId_key" ON "PrepSessionHr"("vacancyId");

-- AddForeignKey
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_hrUserId_fkey" FOREIGN KEY ("hrUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyProfile" ADD CONSTRAINT "CompanyProfile_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepSessionHr" ADD CONSTRAINT "PrepSessionHr_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
