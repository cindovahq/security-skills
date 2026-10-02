import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { apiFetch, saveToken } from "~/lib/api";

export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const code = params.get("code");
    const returnTo = params.get("returnTo");
    if (!code) {
      navigate("/login");
      return;
    }
    apiFetch("/auth/exchange", { method: "POST", body: JSON.stringify({ code }) }).then((res) => {
      saveToken(res.accessToken);
      if (returnTo) {
        window.location.assign(returnTo);
      } else {
        navigate("/tickets");
      }
    });
  }, [params, navigate]);

  return <p>Signing you in…</p>;
}
