import { Link, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/tickets._index";
import { requireUser } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { SearchHighlight } from "~/components/SearchHighlight";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const tickets = db.ticket.forOrg(user.orgId).map((t) => ({ id: t.id, subject: t.subject, status: t.status }));
  return { tickets };
}

export default function Tickets() {
  const { tickets } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  return (
    <main>
      <h1>Tickets</h1>
      <ul>
        {tickets.map((t) => (
          <li key={t.id}>
            <Link to={`/tickets/${t.id}`}>
              <SearchHighlight text={t.subject} query={q} />
            </Link>
            <span> ({t.status})</span>
            <small title={t.subject}>#{t.id}</small>
          </li>
        ))}
      </ul>
    </main>
  );
}
