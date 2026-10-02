import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("auth/callback", "routes/auth.callback.tsx"),
  route("tickets", "routes/tickets._index.tsx"),
  route("tickets/:id", "routes/tickets.$id.tsx"),
  route("articles/:slug", "routes/articles.$slug.tsx"),
  route("u/:handle", "routes/profile.$handle.tsx"),
  route("settings", "routes/settings.tsx"),
  route("reports", "routes/reports.tsx"),
  route("embed", "routes/embed.tsx"),
  route("admin/users", "routes/admin.users.tsx"),
  route("admin/audit", "routes/admin.audit.tsx"),
  route("api/webhooks/billing", "routes/api.webhooks.billing.ts"),
  route("api/webhooks/github", "routes/api.webhooks.github.ts"),
] satisfies RouteConfig;
