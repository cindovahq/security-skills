import { Form, redirect, useActionData } from "react-router";
import type { Route } from "./+types/login";
import { verifyPassword } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { commitSession, getSession } from "~/lib/session.server";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");

  const user = db.user.byEmail(email);
  if (!user) return { error: "No account found for that email" };
  if (!verifyPassword(password, user.passwordHash)) return { error: "Incorrect password" };

  const session = await getSession();
  session.set("userId", user.id);

  const next = new URL(request.url).searchParams.get("next");
  return redirect(next ?? "/tickets", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function Login() {
  const data = useActionData<typeof action>();
  return (
    <Form method="post">
      <label>
        Email <input name="email" type="email" required />
      </label>
      <label>
        Password <input name="password" type="password" required />
      </label>
      {data?.error ? <p role="alert">{data.error}</p> : null}
      <button type="submit">Sign in</button>
    </Form>
  );
}
