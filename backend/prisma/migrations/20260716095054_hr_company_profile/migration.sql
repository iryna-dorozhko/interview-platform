-- AlterTable
ALTER TABLE "CompanyProfile" ADD COLUMN     "companyDirection" JSONB,
ADD COLUMN     "onboardingApproach" JSONB,
ADD COLUMN     "policies" JSONB,
ADD COLUMN     "workFormat" JSONB;

-- CreateTable
CREATE TABLE "HrCompanyProfile" (
    "id" TEXT NOT NULL,
    "hrUserId" TEXT NOT NULL,
    "culture" JSONB NOT NULL,
    "companyDirection" JSONB NOT NULL,
    "policies" JSONB NOT NULL,
    "workFormat" JSONB NOT NULL,
    "onboardingApproach" JSONB NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrCompanyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepSessionCompany" (
    "id" TEXT NOT NULL,
    "hrUserId" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrepSessionCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepMessageCompany" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "authorType" "PrepHrAuthorType" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrepMessageCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrCompanyProfile_hrUserId_key" ON "HrCompanyProfile"("hrUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PrepSessionCompany_hrUserId_key" ON "PrepSessionCompany"("hrUserId");

-- CreateIndex
CREATE INDEX "PrepMessageCompany_sessionId_createdAt_idx" ON "PrepMessageCompany"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "HrCompanyProfile" ADD CONSTRAINT "HrCompanyProfile_hrUserId_fkey" FOREIGN KEY ("hrUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepSessionCompany" ADD CONSTRAINT "PrepSessionCompany_hrUserId_fkey" FOREIGN KEY ("hrUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepMessageCompany" ADD CONSTRAINT "PrepMessageCompany_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PrepSessionCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
