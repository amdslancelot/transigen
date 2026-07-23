import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { redirect } from "next/navigation";
import { query } from "./db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, account, profile }) {
      // Single provisioning path: every account is created/updated here, keyed
      // by the stable Google subject id.
      if (account?.provider === "google" && profile?.sub && profile.email) {
        const rows = await query<{ id: string }>(
          `insert into users (google_sub, email, name, image)
           values ($1, $2, $3, $4)
           on conflict (google_sub) do update
             set email = excluded.email,
                 name = excluded.name,
                 image = excluded.image
           returning id`,
          [profile.sub, profile.email, profile.name ?? null, profile.picture ?? null],
        );
        token.userId = rows[0].id;
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      return session;
    },
  },
});

export type AppUser = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
};

export async function getCurrentUser(): Promise<AppUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
  };
}

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
