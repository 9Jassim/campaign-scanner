import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import SignInForm from './sign-in-form';

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect('/scanner');

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mb-6 text-sm text-zinc-500">
          Campaign Scanner Portal
        </p>
        <SignInForm />
      </div>
    </div>
  );
}
