import type { Route } from "./+types/api.webhooks.billing";
import { db } from "~/lib/db.server";

export async function action({ request }: Route.ActionArgs) {
  const event = await request.json();
  if (event.type === "subscription.updated") {
    db.org.setPlan(event.data.orgId, event.data.plan);
  }
  return new Response(null, { status: 204 });
}
