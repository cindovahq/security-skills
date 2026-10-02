import { useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import { requireUser } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { UsageMeter } from "~/components/UsageMeter";
import { DebugPanel } from "~/components/DebugPanel";
import { ExternalLink } from "~/components/ExternalLink";
import { ThemeToggle } from "~/components/ThemeToggle";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const status = await fetch(process.env.STATUS_API_URL!, {
    headers: { Authorization: `Bearer ${process.env.STATUS_API_TOKEN}` },
  }).then((r) => r.json());
  return { name: user.name, open: db.ticket.forOrg(user.orgId).filter((t) => t.status === "open").length, status };
}

export default function Home() {
  const { name, open, status } = useLoaderData<typeof loader>();
  return (
    <main>
      <h1>Welcome back, {name}</h1>
      <p>{open} open tickets</p>
      <p>Platform status: {status.indicator}</p>
      <UsageMeter />
      <ThemeToggle />
      <ExternalLink href="https://docs.acme.example/helpdesk">Documentation</ExternalLink>
      <DebugPanel />
    </main>
  );
}
