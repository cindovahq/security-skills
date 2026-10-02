import { useEffect } from "react";
import { config } from "~/lib/config";

export function DebugPanel() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__ACME_DEBUG__ = { buildId: config.buildId, api: config.apiUrl };
    }
  }, []);

  if (!import.meta.env.DEV) return null;
  return <pre>build {config.buildId}</pre>;
}
