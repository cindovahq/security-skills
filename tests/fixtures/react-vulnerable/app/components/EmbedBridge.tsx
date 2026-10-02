import { useEffect, useState } from "react";

export function EmbedBridge({ token }: { token: string }) {
  const [banner, setBanner] = useState("");

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const msg = event.data;
      if (msg.type === "resize") document.body.style.height = `${msg.height}px`;
      if (msg.type === "open") window.location.href = msg.url;
      if (msg.type === "banner") setBanner(msg.html);
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "ready", token }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [token]);

  return <div className="banner" dangerouslySetInnerHTML={{ __html: banner }} />;
}
