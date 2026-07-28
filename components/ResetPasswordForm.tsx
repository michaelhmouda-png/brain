'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { resetPassword } from '@/lib/auth';

export function ResetPasswordForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    startTransition(async () => {
      try {
        await resetPassword(password);
        setSuccess(true);
        setTimeout(() => {
          router.push('/login');
        }, 2000);
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to reset password. Please try again or request a new reset link.');
        }
      }
    });
  };

  return (
    <div className="w-full max-w-md">
      <div className="ui-auth-card rounded-3xl p-5 shadow-2xl sm:p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Set new password</h1>
          <p className="mt-2 text-sm text-slate-400">
            Enter a new password for your Brain account.
          </p>
        </div>

        {success ? (
          <div className="space-y-4">
            <div className="ui-alert ui-alert-success rounded-2xl px-4 py-3 text-sm" role="status">
              <p className="font-medium">Password reset successful!</p>
              <p className="mt-1">Redirecting to login...</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300">
                New Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="ui-field mt-2 w-full rounded-2xl px-4 py-3 transition"
              />
              <p className="mt-1 text-xs text-slate-500">At least 8 characters</p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="ui-field mt-2 w-full rounded-2xl px-4 py-3 transition"
              />
            </div>

            {error && (
              <div className="ui-alert ui-alert-error rounded-2xl px-4 py-3 text-sm" role="alert">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isPending}
              className="ui-button-primary w-full rounded-2xl px-4 py-3 font-semibold disabled:cursor-not-allowed"
            >
              {isPending ? 'Resetting...' : 'Reset password'}
            </button>
          </form>
        )}

        <div className="mt-6 border-t border-black pt-6">
          <Link
            href="/login"
            className="ui-link text-sm transition"
          >
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
