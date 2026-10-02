import { useEffect, useRef } from "react";
import { z } from "zod";

const SSO_ORIGIN = "https://sso.acme.example";
const resultSchema = z.object({ type: z.literal("sso-result"), email: z.string().email() });

export function SsoPopup({ onResult }: { onResult: (r: z.infer<typeof resultSchema>) => void }) {
  const popup = useRef<Window | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== SSO_ORIGIN || event.source !== popup.current) return;
      const parsed = resultSchema.safeParse(event.data);
      if (parsed.success) onResult(parsed.data);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onResult]);

  return (
    <button type="button" onClick={() => (popup.current = window.open(`${SSO_ORIGIN}/start`, "sso", "width=480,height=640"))}>
      Sign in with company SSO
    </button>
  );
}
