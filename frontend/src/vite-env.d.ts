/// <reference types="vite/client" />

import "vue-router";

declare module "vue-router" {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestRole?: "HR" | "CANDIDATE";
    requiredRole?: "HR" | "CANDIDATE";
  }
}

interface ImportMetaEnv {
  readonly VITE_DEMO_INTERVIEW_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
