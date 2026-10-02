import { Form, useLoaderData } from "react-router";
import type { Route } from "./+types/reports";
import { requireUser } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { ReportColumn } from "~/components/ReportColumn";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const rows = db.ticket.forOrg(user.orgId).map((t) => ({ id: t.id, subject: t.subject, createdAt: Date.now() - 3 * 86400000 }));
  return { rows, columns: db.report.columns(user.orgId) };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  db.report.addColumn(user.orgId, {
    label: String(form.get("label") ?? ""),
    expression: String(form.get("expression") ?? ""),
  });
  return null;
}

export default function Reports() {
  const { rows, columns } = useLoaderData<typeof loader>();
  return (
    <main>
      <table>
        <thead>
          <tr>
            <th>Subject</th>
            {columns.map((c) => (
              <th key={c.id}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.subject}</td>
              {columns.map((c) => (
                <ReportColumn key={c.id} row={row} expression={c.expression} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Form method="post">
        <input name="label" placeholder="Column label" />
        <input name="expression" placeholder="Expression, e.g. row.id" />
        <button type="submit">Add column</button>
      </Form>
    </main>
  );
}
