import { createHmac, timingSafeEqual } from "node:crypto";
import type { Route } from "./+types/api.webhooks.github";

export async function action({ request }: Route.ActionArgs) {
  const raw = await request.text();
  const expected = createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET!).update(raw).digest("hex");
  const given = (request.headers.get("x-hub-signature-256") ?? "").replace("sha256=", "");

  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(raw);
  console.info("github event", payload.action);
  return new Response(null, { status: 204 });
}
