import DOMPurify from 'isomorphic-dompurify'

export function Announcement({ html }: { html: string }) {
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
  return <div className="announcement" dangerouslySetInnerHTML={{ __html: clean }} />
}
