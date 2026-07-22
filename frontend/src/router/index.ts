import {
  createRouter,
  createWebHistory,
  type RouteLocationRaw,
} from "vue-router";
import { useAuthStore } from "../stores/auth";
import HrLayout from "../layouts/HrLayout.vue";
import HrHomeView from "../views/HrHomeView.vue";
import CompanyProfilePrepView from "../views/CompanyProfilePrepView.vue";
import VacancyListView from "../views/VacancyListView.vue";
import VacancyDetailView from "../views/VacancyDetailView.vue";
import VacancyPrepView from "../views/VacancyPrepView.vue";
import InterviewListView from "../views/InterviewListView.vue";
import InterviewDetailView from "../views/InterviewDetailView.vue";
import LoginView from "../views/LoginView.vue";
import CandidateLoginView from "../views/CandidateLoginView.vue";
import CandidateRegisterView from "../views/CandidateRegisterView.vue";
import CandidateLayout from "../layouts/CandidateLayout.vue";
import CandidateHomeView from "../views/CandidateHomeView.vue";
import CandidateProfileView from "../views/CandidateProfileView.vue";
import CandidateInterviewView from "../views/CandidateInterviewView.vue";
import CandidateMatchesView from "../views/CandidateMatchesView.vue";
import HrApplicationsView from "../views/HrApplicationsView.vue";
import HrInterviewRoomView from "../views/HrInterviewRoomView.vue";
import ReportListView from "../views/ReportListView.vue";
import ReportView from "../views/ReportView.vue";
import CandidateInterviewRoomView from "../views/CandidateInterviewRoomView.vue";
import DialogListView from "../views/DialogListView.vue";
import DialogThreadView from "../views/DialogThreadView.vue";

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
      path: "/join",
      name: "join",
      component: () => import("../views/JoinInterviewView.vue"),
    },
    {
      path: "/candidate",
      component: CandidateLayout,
      meta: { requiresAuth: true, requiredRole: "CANDIDATE" },
      children: [
        { path: "", name: "candidate-home", component: CandidateHomeView },
        { path: "profile", name: "candidate-profile", component: CandidateProfileView },
        { path: "interview", name: "candidate-interview", component: CandidateInterviewView },
        { path: "interview/room", name: "candidate-interview-room", component: CandidateInterviewRoomView },
        { path: "prep/:interviewId", name: "candidate-prep", redirect: { name: "candidate-profile" } },
        { path: "matches", name: "candidate-matches", component: CandidateMatchesView },
        { path: "dialogs", name: "candidate-dialogs", component: DialogListView },
        { path: "dialogs/:id", name: "candidate-dialog", component: DialogThreadView },
      ],
    },
    {
      path: "/",
      component: HrLayout,
      meta: { requiresAuth: true, requiredRole: "HR" },
      children: [
        { path: "", name: "home", component: HrHomeView },
        {
          path: "company-profile",
          name: "company-profile",
          component: CompanyProfilePrepView,
        },
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
          path: "applications",
          name: "hr-applications",
          component: HrApplicationsView,
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
        {
          path: "interviews/:id/room",
          name: "interview-room",
          component: HrInterviewRoomView,
        },
        {
          path: "reports",
          name: "reports",
          component: ReportListView,
        },
        {
          path: "report/:id",
          name: "report",
          component: ReportView,
        },
        { path: "dialogs", name: "hr-dialogs", component: DialogListView },
        { path: "dialogs/:id", name: "hr-dialog", component: DialogThreadView },
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
