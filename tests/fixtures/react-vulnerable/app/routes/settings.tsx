import { Form, useActionData } from "react-router";
import type { Route } from "./+types/settings";
import { requireUser } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { deepMerge } from "~/lib/merge.server";

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const updates: Record<string, unknown> = Object.fromEntries(form);

  const preferences = form.get("preferences");
  if (typeof preferences === "string" && preferences) {
    updates.preferences = deepMerge(user.preferences, JSON.parse(preferences));
  }

  db.user.update(user.id, updates);
  return { saved: true };
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return { name: user.name, bio: user.bio, website: user.website };
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  return (
    <Form method="post">
      <input name="name" defaultValue={loaderData.name} />
      <textarea name="bio" defaultValue={loaderData.bio} />
      <input name="website" defaultValue={loaderData.website ?? ""} />
      <input type="hidden" name="preferences" value="{}" />
      <button type="submit">Save</button>
      {result?.saved ? <p>Saved</p> : null}
    </Form>
  );
}
