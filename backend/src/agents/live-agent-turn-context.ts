import type { ArbiterAction } from "./arbiter-agent";

export type LiveAgentTurnContext = {
  action: ArbiterAction;
  briefUk?: string;
};
