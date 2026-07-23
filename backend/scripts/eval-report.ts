import "dotenv/config";
import { prisma, disconnectPrisma } from "../src/db/prisma";
import {
  listEvalSnapshots,
  summarizeEvalSnapshots,
} from "../src/services/interview-eval";

function usage(): never {
  console.error(
    "Usage: npm run eval:report -- --from=ISO --to=ISO [--json]",
  );
  process.exit(1);
}

function parseArgs(argv: string[]): {
  from: string | null;
  to: string | null;
  json: boolean;
} {
  let from: string | null = null;
  let to: string | null = null;
  let json = false;
  for (const arg of argv) {
    if (arg.startsWith("--from=")) from = arg.slice("--from=".length);
    else if (arg.startsWith("--to=")) to = arg.slice("--to=".length);
    else if (arg === "--json") json = true;
  }
  return { from, to, json };
}

async function main(): Promise<void> {
  const { from, to, json } = parseArgs(process.argv.slice(2));
  if (!from || !to) usage();
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    console.error("Invalid from/to ISO dates");
    process.exit(1);
  }

  const snapshots = await listEvalSnapshots(prisma, fromDate, toDate);
  const summary = summarizeEvalSnapshots(snapshots);

  if (json) {
    console.log(JSON.stringify({ summary, snapshots }, null, 2));
  } else {
    console.log("Eval summary");
    console.log(`  range: ${from} .. ${to} (to exclusive)`);
    console.log(`  snapshots: ${summary.snapshotCount}`);
    console.log(`  withDecision: ${summary.withDecisionCount}`);
    console.log(`  avgPrepCandidateMs: ${summary.avgPrepCandidateDurationMs}`);
    console.log(`  avgPrepVacancyMs: ${summary.avgPrepVacancyDurationMs}`);
    console.log(`  avgLiveMs: ${summary.avgLiveDurationMs}`);
    console.log(`  avgAutoRetry: ${summary.avgAutoRetryCount}`);
    console.log(`  avgManualRetry: ${summary.avgManualRetryCount}`);
    console.log(`  avgHrMessages: ${summary.avgHrMessageCount}`);
    console.log(`  avgHrControl: ${summary.avgHrControlActionCount}`);
    console.log(`  clarifyingRate: ${summary.clarifyingRate}`);
    console.log(`  avgMatch: ${summary.avgFinalMatchScore}`);
    console.log(`  agreementRate: ${summary.agreementRate}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
