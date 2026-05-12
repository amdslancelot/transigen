import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="container col" style={{ gap: "1rem", paddingTop: "2rem" }}>
      <h1>Transigen</h1>
      <p className="muted">
        Build a shared transition library for song pairs, then chain them into DJ
        sets under 1 hour.
      </p>
      <div className="row">
        {user ? (
          <>
            <Link className="pill" href="/room">
              Browse rooms
            </Link>
            <Link className="pill" href="/transition">
              Saved transitions
            </Link>
            <Link className="pill" href="/room/new">
              Create room set
            </Link>
          </>
        ) : (
          <Link className="pill" href="/login">
            Sign in
          </Link>
        )}
      </div>
    </main>
  );
}
