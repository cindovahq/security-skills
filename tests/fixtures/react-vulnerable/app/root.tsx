import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/root";
import { getUser } from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  return { user, orgName: user ? `Org ${user.orgId}` : null, flags: { newInbox: true } };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__ACME__ = ${JSON.stringify({
              name: data?.user?.name ?? null,
              org: data?.orgName ?? null,
              flags: data?.flags ?? {},
            })};`,
          }}
        />
      </head>
      <body>
        <nav>
          <a href="/">Home</a> <a href="/tickets">Tickets</a>
          {data?.user ? <span>Signed in as {data.user.name}</span> : <a href="/login">Sign in</a>}
        </nav>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
