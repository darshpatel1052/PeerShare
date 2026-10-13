"use client";
import { useEffect, useState } from "react";
import { Icon } from "./ui";

export default function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    let saved = "dark";
    try {
      saved = localStorage.getItem("peerscreen-theme") || "dark";
    } catch {}
    const next = saved === "light";
    document.documentElement.dataset.theme = next ? "light" : "dark";
    setLight(next);
  }, []);
  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.dataset.theme = next ? "light" : "dark";
    try {
      localStorage.setItem("peerscreen-theme", next ? "light" : "dark");
    } catch {}
  }
  return (
    <button
      className="icon-button theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${light ? "dark" : "light"} theme`}
      title={`Switch to ${light ? "dark" : "light"} theme`}
    >
      <Icon name={light ? "moon" : "sun"} />
    </button>
  );
}
