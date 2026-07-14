<script setup lang="ts">
import { computed } from "vue";
import type { AgentThinkingState, LiveAuthorType } from "../composables/useInterviewRoom";

const props = defineProps<{
  agentThinking: AgentThinkingState | null;
}>();

type AgentKey = "AGENT_ARBITER" | "AGENT_COMPANY" | "AGENT_CANDIDATE";

const AGENTS: Array<{ key: AgentKey; label: string }> = [
  { key: "AGENT_ARBITER", label: "Arbiter" },
  { key: "AGENT_COMPANY", label: "Компанія" },
  { key: "AGENT_CANDIDATE", label: "Кандидат (AI)" },
];

function statusFor(agentType: AgentKey): "thinking" | "idle" {
  if (props.agentThinking?.active && props.agentThinking.agentType === agentType) {
    return "thinking";
  }
  return "idle";
}

const activeAgent = computed(() => props.agentThinking?.agentType as LiveAuthorType | undefined);
</script>

<template>
  <aside class="agent-panel" aria-label="Статус AI-агентів">
    <h2 class="panel-title">AI-процеси</h2>
    <ul class="agent-list">
      <li
        v-for="agent in AGENTS"
        :key="agent.key"
        class="agent-item"
        :class="statusFor(agent.key)"
      >
        <span class="agent-name">{{ agent.label }}</span>
        <span class="agent-status">
          {{ statusFor(agent.key) === "thinking" ? "думає…" : "очікує" }}
        </span>
      </li>
    </ul>
    <p v-if="activeAgent" class="panel-hint">
      Зараз активний: {{ AGENTS.find((a) => a.key === activeAgent)?.label }}
    </p>
  </aside>
</template>

<style scoped>
.agent-panel {
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}
.panel-title {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.agent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.agent-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.375rem 0.5rem;
  border-radius: 0.375rem;
  font-size: 0.8125rem;
}
.agent-item.thinking {
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid var(--accent-border);
}
.agent-item.idle {
  background: var(--surface-muted);
  color: var(--muted);
  border: 1px solid transparent;
}
.agent-name {
  font-weight: 500;
}
.agent-status {
  font-size: 0.75rem;
}
.panel-hint {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: var(--muted);
}
</style>
