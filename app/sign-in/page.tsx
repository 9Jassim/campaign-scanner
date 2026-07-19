import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import ThemeToggle from '@/components/theme-toggle';
import SignInForm from './sign-in-form';

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect('/scanner');

  return (
    <div className="flex flex-1 flex-col p-6">
      {/* There is no nav here, so the toggle would otherwise be unreachable
          until after signing in — on a shared till the sign-in screen is the
          one most likely to be glaring. */}
      <div className="flex justify-end">
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-sm">
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mb-6 text-sm text-zinc-500">Campaign Scanner Portal</p>
          <SignInForm />
        </div>
      </div>
    </div>
  );
}
