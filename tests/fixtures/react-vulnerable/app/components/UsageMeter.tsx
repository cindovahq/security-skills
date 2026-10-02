import { useEffect, useState } from "react";
import { adminFetch } from "~/lib/api";

export function UsageMeter() {
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);

  useEffect(() => {
    adminFetch("/admin/usage").then(setUsage);
  }, []);

  if (!usage) return null;
  return (
    <p>
      {usage.used} / {usage.limit} seats
    </p>
  );
}
