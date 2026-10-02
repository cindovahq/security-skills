export function EmailPreview({ html }: { html: string }) {
  return <iframe title="Original email" srcDoc={html} style={{ width: "100%", height: 320, border: 0 }} />;
}
