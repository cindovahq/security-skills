import { marked } from "marked";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/articles.$slug";
import { db } from "~/lib/db.server";
import { JsonLd } from "~/components/JsonLd";

export async function loader({ params }: Route.LoaderArgs) {
  const article = db.article.bySlug(params.slug);
  if (!article) throw new Response("Not found", { status: 404 });
  return { title: article.title, html: await marked.parse(article.markdown), slug: article.slug };
}

export default function Article() {
  const { title, html, slug } = useLoaderData<typeof loader>();
  return (
    <article>
      <JsonLd data={{ "@context": "https://schema.org", "@type": "Article", headline: title, url: `/articles/${slug}` }} />
      <h1>{title}</h1>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
