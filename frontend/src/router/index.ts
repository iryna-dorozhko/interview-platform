import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
import CompanyPrepView from "../views/CompanyPrepView.vue";
import HomeView from "../views/HomeView.vue";
import LoginView from "../views/LoginView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: LoginView },
    { path: "/", name: "home", component: HomeView, meta: { requiresAuth: true } },
    {
      path: "/prep/:interviewId",
      name: "company-prep",
      component: CompanyPrepView,
      meta: { requiresAuth: true },
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.hydrated) {
    await auth.restoreSession();
  }

  if (to.meta.requiresAuth && !auth.token) {
    return { name: "login", query: { redirect: to.fullPath } };
  }

  if (to.name === "login" && auth.token) {
    return { name: "home" };
  }
});
