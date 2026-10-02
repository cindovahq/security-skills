import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { destroySession, getSession } from "~/lib/session.server";
import { toLocalPath } from "~/lib/redirect";

export async function action({ request }: Route.ActionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const to = toLocalPath(new URL(request.url).searchParams.get("to"), "/login");
  return redirect(to, { headers: { "Set-Cookie": await destroySession(session) } });
}
