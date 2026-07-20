import type { ArbiterAction } from "./arbiter-agent";

export type LiveAgentTurnContext = {
  action: ArbiterAction | "ANSWER_CANDIDATE";
  briefUk?: string;
};
