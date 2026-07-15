import Link from "next/link";
import { auth } from "@/auth";
import SignOutButton from "@/components/sign-out-button";

export default async function Home() {
  const session = await auth();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Campaign Scanner</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        Multi-store WhatsApp campaign scanner portal. Sign in to access the
        scanner, dashboard, and settings for your store.
      </p>

      {session?.user ? (
        <div className="flex items-center gap-4">
          <Link
            href="/scanner"
            className="flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:opacity-90"
          >
            Go to scanner
          </Link>
          <SignOutButton />
        </div>
      ) : (
        <Link
          href="/sign-in"
          className="flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:opacity-90"
        >
          Sign in
        </Link>
      )}
    </div>
  );
}
