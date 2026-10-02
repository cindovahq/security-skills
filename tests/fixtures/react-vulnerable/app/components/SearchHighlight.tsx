import { useEffect, useRef } from "react";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function SearchHighlight({ text, query }: { text: string; query: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (!query) {
      ref.current.textContent = text;
      return;
    }
    const matcher = new RegExp(`(${escapeRegExp(query)})`, "gi");
    ref.current.innerHTML = text.replace(matcher, "<mark>$1</mark>");
  }, [text, query]);

  return <span ref={ref} />;
}
