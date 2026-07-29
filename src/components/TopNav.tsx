"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/room", label: "rooms" },
  { href: "/transition", label: "transitions" },
  { href: "/room/new", label: "new set" },
];

/** Nav links for the fixed top bar; marks the current section for styling. */
export function TopNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="row" style={{ gap: "1rem", flexWrap: "nowrap" }}>
      {LINKS.map(({ href, label }) => {
        const current =
          href === "/room/new"
            ? pathname === "/room/new"
            : pathname === href || (pathname.startsWith(`${href}/`) && pathname !== "/room/new");
        return (
          <Link key={href} href={href} className="topbar-link" aria-current={current ? "page" : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
