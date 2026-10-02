import { Form, Navigate, useLoaderData, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/admin.users";
import { requireUser } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import type { loader as rootLoader } from "~/root";

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  return { users: db.user.list() };
}

export async function action({ request }: Route.ActionArgs) {
  await requireUser(request);
  const form = await request.formData();
  db.user.update(String(form.get("id")), { role: String(form.get("role")) });
  return null;
}

export default function AdminUsers() {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const { users } = useLoaderData<typeof loader>();

  if (root?.user?.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return (
    <main>
      <h1>Users</h1>
      <table>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>
                <Form method="post">
                  <input type="hidden" name="id" value={u.id} />
                  <select name="role" defaultValue={u.role}>
                    <option value="customer">customer</option>
                    <option value="agent">agent</option>
                    <option value="admin">admin</option>
                  </select>
                  <button type="submit">Update</button>
                </Form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
