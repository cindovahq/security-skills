import ReactMarkdown from "react-markdown";

export function Comment({ text }: { text: string }) {
  return (
    <div className="comment">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}
