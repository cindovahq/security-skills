import { Form, useLoaderData } from "react-router";
import type { Route } from "./+types/tickets.$id";
import { requireUser } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { TicketBody } from "~/components/TicketBody";
import { EmailPreview } from "~/components/EmailPreview";
import { Comment } from "~/components/Comment";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);
  const ticket = db.ticket.byId(params.id);
  if (!ticket) throw new Response("Not found", { status: 404 });
  return { ticket };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "comment") {
    db.ticket.addComment(params.id, { authorId: user.id, text: String(form.get("text") ?? "") });
  } else if (intent === "close") {
    db.ticket.setStatus(params.id, "closed");
  }
  return null;
}

export default function TicketPage() {
  const { ticket } = useLoaderData<typeof loader>();
  return (
    <main>
      <h1>{ticket.subject}</h1>
      <TicketBody html={ticket.bodyHtml} />
      {ticket.emailHtml ? <EmailPreview html={ticket.emailHtml} /> : null}
      <section>
        {ticket.comments.map((c) => (
          <Comment key={c.id} text={c.text} />
        ))}
      </section>
      <Form method="post">
        <textarea name="text" />
        <button name="intent" value="comment">Reply</button>
        <button name="intent" value="close">Close ticket</button>
      </Form>
    </main>
  );
}
