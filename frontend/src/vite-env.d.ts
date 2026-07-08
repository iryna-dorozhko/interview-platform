/// <reference types="vite/client" />

import "vue-router";

declare module "vue-router" {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestRole?: "HR" | "CANDIDATE";
    requiredRole?: "HR" | "CANDIDATE";
  }
}
