import { Form, useLoaderData } from "react-router";
import type { Route } from "./+types/admin.audit";
import { requireRole } from "~/lib/auth.server";
import { db } from "~/lib/db.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireRole(request, "admin");
  return { entries: db.audit.recent() };
}

export async function action({ request }: Route.ActionArgs) {
  await requireRole(request, "admin");
  return null;
}

export default function AuditLog() {
  const { entries } = useLoaderData<typeof loader>();
  return (
    <main>
      <h1>Audit log</h1>
      <ul>
        {entries.map((e) => (
          <li key={e.id}>
            {e.actor}: {e.action}
          </li>
        ))}
      </ul>
      <Form method="post">
        <button type="submit">Export</button>
      </Form>
    </main>
  );
}
