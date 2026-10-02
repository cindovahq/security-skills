export function TicketBody({ html }: { html: string }) {
  return <div className="ticket-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
