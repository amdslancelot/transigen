import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Transigen",
  description: "Collaborative transition picker and room set builder",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
