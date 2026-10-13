import type { Metadata } from "next";
import Navigation from "../components/navigation";
import { AuthProvider } from "../components/auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "PeerScreen · Video, shared",
  description:
    "A video publishing application with opt-in peer-assisted delivery.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <AuthProvider>
          <Navigation />
          {children}
        </AuthProvider>
        <footer>
          PeerScreen{" "}
          <span>Video, shared. Built one verified step at a time.</span>
        </footer>
      </body>
    </html>
  );
}
