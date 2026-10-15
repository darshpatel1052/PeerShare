"use client";
import { useTheme } from "./theme-provider";
import { Icon } from "./ui";

export default function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  return (
    <section className="settings-panel" id="appearance">
      <div className="settings-heading">
        <div>
          <h2>Appearance</h2>
          <p>Choose how PeerShare looks on this device.</p>
        </div>
        <Icon name="sun" />
      </div>
      <div className="theme-options" role="group" aria-label="Color theme">
        {(["dark", "light"] as const).map((value) => (
          <button
            key={value}
            className={`theme-option ${value}-preview${theme === value ? " selected" : ""}`}
            aria-pressed={theme === value}
            onClick={() => setTheme(value)}
          >
            <span className="theme-miniature" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>
              {value === "dark" ? "Dark" : "Light"}
              <Icon
                name={
                  theme === value ? "check" : value === "dark" ? "moon" : "sun"
                }
              />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
