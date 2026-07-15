import "dotenv/config";
import { createLlmProvider } from "../src/llm/factory";

function readMessageArg(): string {
  const messageIndex = process.argv.indexOf("--message");
  if (messageIndex !== -1 && process.argv[messageIndex + 1]) {
    return process.argv[messageIndex + 1];
  }
  return "Скажи одне речення українською.";
}

async function main(): Promise<void> {
  const message = readMessageArg();
  const provider = createLlmProvider();

  try {
    console.log(`Provider: ${provider.name}`);
    console.log(`Prompt: ${message}`);

    const sequentialOne = await provider.complete([
      { role: "user", content: `${message} [sequential-1]` },
    ]);
    const sequentialTwo = await provider.complete([
      { role: "user", content: `${message} [sequential-2]` },
    ]);
    const [parallelOne, parallelTwo] = await Promise.all([
      provider.complete([
        { role: "user", content: `${message} [parallel-1]` },
      ]),
      provider.complete([
        { role: "user", content: `${message} [parallel-2]` },
      ]),
    ]);

    console.log(`Sequential 1: ${sequentialOne}`);
    console.log(`Sequential 2: ${sequentialTwo}`);
    console.log(`Parallel 1: ${parallelOne}`);
    console.log(`Parallel 2: ${parallelTwo}`);
  } finally {
    await provider.close?.();
  }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`LLM test failed: ${detail}`);
  process.exit(1);
});
