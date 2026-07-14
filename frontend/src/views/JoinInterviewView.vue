<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { joinInterviewByCode } from "../api/candidate-interview";
import { useAuthStore } from "../stores/auth";
import { storeJoinedBanner } from "../utils/join-banner";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const code = computed(() => {
  const raw = route.query.code;
  return typeof raw === "string" ? raw.trim() : "";
});

const redirectPath = computed(() =>
  code.value ? `/join?code=${encodeURIComponent(code.value)}` : "/join",
);

const loginLink = computed(() => ({
  name: "candidate-login" as const,
  query: { redirect: redirectPath.value },
}));

type ViewState = "missing-code" | "redirecting" | "joining" | "hr-blocked" | "error";
const viewState = ref<ViewState>("redirecting");
const errorMessage = ref<string | null>(null);

async function tryJoin(): Promise<void> {
  if (!code.value) {
    viewState.value = "missing-code";
    return;
  }

  if (!auth.token) {
    viewState.value = "redirecting";
    await router.replace(loginLink.value);
    return;
  }

  if (auth.user?.role === "HR") {
    viewState.value = "hr-blocked";
    return;
  }

  viewState.value = "joining";
  try {
    const interview = await joinInterviewByCode(code.value);
    storeJoinedBanner(interview);
    await router.replace({ name: "candidate-home" });
  } catch (error) {
    viewState.value = "error";
    errorMessage.value =
      error instanceof Error ? error.message : "Не вдалося приєднатися до співбесіди";
  }
}

onMounted(() => {
  void tryJoin();
});
</script>

<template>
  <main class="page">
    <h1>Приєднання до співбесіди</h1>

    <p v-if="viewState === 'missing-code'" class="error">Код не вказано</p>

    <p v-else-if="viewState === 'redirecting' || viewState === 'joining'" class="status">
      {{ viewState === "joining" ? "Приєднання…" : "Перенаправлення…" }}
    </p>

    <template v-else-if="viewState === 'hr-blocked'">
      <p class="error">Увійдіть як кандидат</p>
      <p class="helper">
        <RouterLink :to="loginLink">Увійти як кандидат</RouterLink>
      </p>
    </template>

    <template v-else-if="viewState === 'error'">
      <p class="error">{{ errorMessage }}</p>
      <p class="helper">
        <RouterLink :to="{ name: 'candidate-home' }">На головну</RouterLink>
      </p>
    </template>
  </main>
</template>

<style scoped>
.page {
  max-width: 24rem;
  margin: 2rem auto;
  padding: 0 1rem;
}
.error {
  color: var(--danger);
}
.status {
  color: #6b7280;
}
.helper {
  margin-top: 1.5rem;
  font-size: 0.875rem;
  color: #6b7280;
}
</style>
