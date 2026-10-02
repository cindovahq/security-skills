import { useLoaderData } from "react-router";
import type { Route } from "./+types/profile.$handle";
import { db } from "~/lib/db.server";
import { RichText } from "~/components/RichText";

export async function loader({ params }: Route.LoaderArgs) {
  const user = db.user.byHandle(params.handle);
  if (!user) throw new Response("Not found", { status: 404 });
  return { name: user.name, handle: user.handle, bio: user.bio, website: user.website };
}

export default function Profile() {
  const profile = useLoaderData<typeof loader>();
  return (
    <main>
      <h1>{profile.name}</h1>
      <p>@{profile.handle}</p>
      <RichText html={profile.bio} />
      {profile.website ? (
        <a href={profile.website} target="_blank">
          {profile.website}
        </a>
      ) : null}
    </main>
  );
}
