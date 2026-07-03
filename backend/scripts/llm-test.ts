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

  console.log(`Provider: ${provider.name}`);
  console.log(`Prompt: ${message}`);

  const text = await provider.complete([{ role: "user", content: message }]);
  console.log(`Response: ${text}`);
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`LLM test failed: ${detail}`);
  process.exit(1);
});
