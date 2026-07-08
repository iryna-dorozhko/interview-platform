import { defineStore } from "pinia";
import { ref } from "vue";
import {
  clearSession,
  fetchMe,
  loginCandidate as apiLoginCandidate,
  loginHr as apiLoginHr,
  registerCandidate as apiRegisterCandidate,
  type AuthUser,
} from "../api/auth";
import { getStoredToken } from "../api/client";

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(getStoredToken());
  const user = ref<AuthUser | null>(null);
  const hydrated = ref(false);

  async function restoreSession(): Promise<void> {
    if (!token.value) {
      hydrated.value = true;
      return;
    }
    try {
      user.value = await fetchMe();
    } catch {
      token.value = null;
      user.value = null;
      clearSession();
    } finally {
      hydrated.value = true;
    }
  }

  async function loginHr(email: string, password: string): Promise<void> {
    const loggedInUser = await apiLoginHr(email, password);
    token.value = getStoredToken();
    user.value = loggedInUser;
  }

  async function registerCandidate(
    email: string,
    password: string,
  ): Promise<void> {
    const loggedInUser = await apiRegisterCandidate(email, password);
    token.value = getStoredToken();
    user.value = loggedInUser;
  }

  async function loginCandidate(email: string, password: string): Promise<void> {
    const loggedInUser = await apiLoginCandidate(email, password);
    token.value = getStoredToken();
    user.value = loggedInUser;
  }

  function logout(): void {
    token.value = null;
    user.value = null;
    clearSession();
  }

  return {
    token,
    user,
    hydrated,
    restoreSession,
    loginHr,
    registerCandidate,
    loginCandidate,
    logout,
  };
});
