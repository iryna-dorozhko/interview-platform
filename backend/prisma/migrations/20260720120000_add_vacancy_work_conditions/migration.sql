-- AlterTable
ALTER TABLE "CompanyProfile" ADD COLUMN "workConditions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "compensation" JSONB;
