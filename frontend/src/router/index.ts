import {
  createRouter,
  createWebHistory,
  type RouteLocationRaw,
} from "vue-router";
import { useAuthStore } from "../stores/auth";
import HrLayout from "../layouts/HrLayout.vue";
import HrHomeView from "../views/HrHomeView.vue";
import VacancyListView from "../views/VacancyListView.vue";
import VacancyDetailView from "../views/VacancyDetailView.vue";
import VacancyPrepView from "../views/VacancyPrepView.vue";
import InterviewListView from "../views/InterviewListView.vue";
import InterviewDetailView from "../views/InterviewDetailView.vue";
import LoginView from "../views/LoginView.vue";
import CandidateLoginView from "../views/CandidateLoginView.vue";
import CandidateRegisterView from "../views/CandidateRegisterView.vue";
import CandidateHomeView from "../views/CandidateHomeView.vue";

function homeByRole(role: "HR" | "CANDIDATE"): RouteLocationRaw {
  return role === "HR" ? { name: "home" } : { name: "candidate-home" };
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: LoginView,
      meta: { guestRole: "HR" },
    },
    {
      path: "/candidate/login",
      name: "candidate-login",
      component: CandidateLoginView,
      meta: { guestRole: "CANDIDATE" },
    },
    {
      path: "/candidate/register",
      name: "candidate-register",
      component: CandidateRegisterView,
      meta: { guestRole: "CANDIDATE" },
    },
    {
      path: "/candidate",
      name: "candidate-home",
      component: CandidateHomeView,
      meta: { requiresAuth: true, requiredRole: "CANDIDATE" },
    },
    {
      path: "/",
      component: HrLayout,
      meta: { requiresAuth: true, requiredRole: "HR" },
      children: [
        { path: "", name: "home", component: HrHomeView },
        { path: "vacancies", name: "vacancies", component: VacancyListView },
        {
          path: "vacancies/:id",
          name: "vacancy-detail",
          component: VacancyDetailView,
        },
        {
          path: "vacancies/:id/prep",
          name: "vacancy-prep",
          component: VacancyPrepView,
        },
        {
          path: "interviews",
          name: "interviews",
          component: InterviewListView,
        },
        {
          path: "interviews/:id",
          name: "interview-detail",
          component: InterviewDetailView,
        },
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

  const requiresAuth = to.meta.requiresAuth === true;
  const requiredRole = to.meta.requiredRole;

  if (requiresAuth && (!auth.token || !auth.user)) {
    return requiredRole === "CANDIDATE"
      ? { name: "candidate-login", query: { redirect: to.fullPath } }
      : { name: "login", query: { redirect: to.fullPath } };
  }

  if (auth.user && requiredRole && auth.user.role !== requiredRole) {
    return homeByRole(auth.user.role);
  }

  if (auth.user && to.meta.guestRole) {
    return homeByRole(auth.user.role);
  }
});
