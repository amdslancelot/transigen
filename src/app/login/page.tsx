import Link from "next/link";
import { getCurrentUser, signIn, signOut } from "@/lib/auth";

export default async function LoginPage() {
  const user = await getCurrentUser();

  return (
    <main className="container col" style={{ gap: "1rem", paddingTop: "2rem" }}>
      <h1>Sign in</h1>

      {user ? (
        <div className="panel col">
          <p className="muted" style={{ marginTop: 0 }}>
            Signed in as <strong>{user.email ?? user.name ?? user.id}</strong>
          </p>
          <div className="row">
            <Link href="/">
              <button type="button">Go to app</button>
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button className="secondary" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="panel col">
          <p className="muted" style={{ marginTop: 0 }}>
            Sign in with your Google account to create rooms and propose transitions.
          </p>
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button type="submit">Continue with Google</button>
          </form>
        </div>
      )}
    </main>
  );
}
