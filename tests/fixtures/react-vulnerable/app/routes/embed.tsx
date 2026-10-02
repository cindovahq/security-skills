import { useEffect, useState } from "react";
import { getToken } from "~/lib/api";
import { EmbedBridge } from "~/components/EmbedBridge";
import { SsoPopup } from "~/components/SsoPopup";

export default function Embed() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => setToken(getToken()), []);
  return (
    <main>
      <SsoPopup onResult={(r) => console.info("sso", r.email)} />
      {token ? <EmbedBridge token={token} /> : <p>Not signed in</p>}
    </main>
  );
}
