import { notFound } from 'next/navigation'
import { draftMode } from 'next/headers'
import { marked } from 'marked'
import ReactMarkdown from 'react-markdown'
import { db } from '@/lib/db'

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { isEnabled } = await draftMode()

  const post = await db.post.findFirst({
    where: { slug, ...(isEnabled ? {} : { published: true }) },
    include: {
      author: { select: { displayName: true, username: true } },
      comments: { select: { id: true, body: true } },
    },
  })
  if (!post) notFound()

  const html = await marked.parse(post.body)

  return (
    <article>
      <h1>{post.title}</h1>
      <p>
        by <a href={`/profile/${post.author.username}`}>{post.author.displayName}</a>
      </p>
      <div className="post-body" dangerouslySetInnerHTML={{ __html: html }} />
      <section>
        <h2>Comments</h2>
        {post.comments.map((c) => (
          <div key={c.id} className="comment">
            <ReactMarkdown>{c.body}</ReactMarkdown>
          </div>
        ))}
      </section>
    </article>
  )
}
