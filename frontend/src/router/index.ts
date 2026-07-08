import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
import HrLayout from "../layouts/HrLayout.vue";
import HrHomeView from "../views/HrHomeView.vue";
import VacancyListView from "../views/VacancyListView.vue";
import VacancyDetailView from "../views/VacancyDetailView.vue";
import VacancyPrepView from "../views/VacancyPrepView.vue";
import InterviewListView from "../views/InterviewListView.vue";
import InterviewDetailView from "../views/InterviewDetailView.vue";
import LoginView from "../views/LoginView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: LoginView },
    {
      path: "/",
      component: HrLayout,
      meta: { requiresAuth: true },
      children: [
        { path: "", name: "home", component: HrHomeView },
        { path: "vacancies", name: "vacancies", component: VacancyListView },
        { path: "vacancies/:id", name: "vacancy-detail", component: VacancyDetailView },
        { path: "vacancies/:id/prep", name: "vacancy-prep", component: VacancyPrepView },
        { path: "interviews", name: "interviews", component: InterviewListView },
        { path: "interviews/:id", name: "interview-detail", component: InterviewDetailView },
      ],
    },
    { path: "/prep/:interviewId", redirect: "/vacancies" },
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
