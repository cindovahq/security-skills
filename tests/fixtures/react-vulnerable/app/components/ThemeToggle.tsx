import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = localStorage.getItem("acme_theme");
    if (saved === "dark" || saved === "light") setTheme(saved);
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    localStorage.setItem("acme_theme", next);
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }

  return <button onClick={toggle}>Theme: {theme}</button>;
}
