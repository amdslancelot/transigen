import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";

// /login is no longer a page. With Google as the only provider there is nothing
// to choose, so this route immediately starts the Google OAuth flow. Every
// existing entry point (the home page "Sign in" link and the requireUser()
// redirect) therefore lands on accounts.google.com in a single hop.
export async function GET(request: Request) {
  const url = new URL(request.url);

  // Auth.js redirects OAuth errors back to pages.signIn ("/login"). Bail out to
  // the home page in that case instead of bouncing the user straight back to
  // Google, which would create a redirect loop.
  if (url.searchParams.has("error")) {
    redirect("/");
  }

  const session = await auth();
  if (session?.user) {
    redirect("/");
  }

  await signIn("google", { redirectTo: "/" });
}
