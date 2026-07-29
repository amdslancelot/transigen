import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

/** Signed-in users skip the landing entirely; rooms is the home of the app. */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect("/room");

  return (
    <main className="container col" style={{ minHeight: "calc(100vh - 90px)", gap: "0.5rem" }}>
      <div className="col" style={{ flex: 1, justifyContent: "center", gap: 0 }}>
        <Link href="/login" className="rule-row">
          <div className="row" style={{ alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
            <span className="rule-row-title" style={{ fontSize: "2.75rem", lineHeight: 1.1 }}>
              Sign in
            </span>
            <span className="muted">with Google</span>
          </div>
        </Link>
      </div>
    </main>
  );
}
