import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Inter } from "next/font/google";
import { getCurrentUser, signOut } from "@/lib/auth";
import { TopNav } from "@/components/TopNav";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Transigen",
  description: "Collaborative transition picker and room set builder",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();

  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <header className="topbar">
          <Link href="/" className="topbar-wordmark">
            Transigen
          </Link>
          {user ? <TopNav /> : null}
          <span style={{ flex: 1 }} />
          {user ? (
            <>
              <span className="muted" style={{ fontSize: "0.72rem" }}>
                {user.email ?? user.name ?? user.id}
              </span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  className="secondary"
                  type="submit"
                  style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }}
                >
                  sign out
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className="topbar-link">
              sign in
            </Link>
          )}
        </header>
        {children}
      </body>
    </html>
  );
}
