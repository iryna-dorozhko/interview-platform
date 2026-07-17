<script setup lang="ts">
import { computed } from "vue";
import type {
  AgentThinkingState,
  ArbiterProcessEntry,
  LiveAuthorType,
} from "../composables/useInterviewRoom";

const props = defineProps<{
  agentThinking: AgentThinkingState | null;
  processLog?: ArbiterProcessEntry[];
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

const processEntries = computed(() => props.processLog ?? []);

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}
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
    <div v-if="processEntries.length > 0" class="process-log">
      <h3 class="process-title">Рішення Arbiter</h3>
      <ul class="process-list">
        <li v-for="(entry, index) in processEntries" :key="`${entry.at}-${index}`" class="process-item">
          <span class="process-time">{{ formatTime(entry.at) }}</span>
          <span class="process-summary">{{ entry.summaryUk }}</span>
        </li>
      </ul>
    </div>
  </aside>
</template>

<style scoped>
.agent-panel {
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  position: sticky;
  top: 1rem;
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
.process-log {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
}
.process-title {
  margin: 0 0 0.375rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--muted);
}
.process-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  max-height: 20rem;
  overflow-y: auto;
}
.process-item {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  font-size: 0.75rem;
  line-height: 1.35;
}
.process-time {
  flex-shrink: 0;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.process-summary {
  color: var(--text);
}
</style>
