"use client";
import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";
const Context = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
} | null>(null);
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, update] = useState<Theme>("dark");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("peerscreen-theme");
      if (saved === "light" || saved === "dark") update(saved);
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  function setTheme(value: Theme) {
    update(value);
    try {
      localStorage.setItem("peerscreen-theme", value);
    } catch {}
  }
  return (
    <Context.Provider value={{ theme, setTheme }}>{children}</Context.Provider>
  );
}
export function useTheme() {
  const value = useContext(Context);
  if (!value) throw new Error("Theme provider is missing");
  return value;
}
