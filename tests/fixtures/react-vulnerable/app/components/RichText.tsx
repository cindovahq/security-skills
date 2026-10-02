import DOMPurify from "isomorphic-dompurify";

export function RichText({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />;
}
