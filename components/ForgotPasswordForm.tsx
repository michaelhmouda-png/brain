'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { requestPasswordReset } from '@/lib/auth';

export function ForgotPasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    startTransition(async () => {
      try {
        await requestPasswordReset(email);
        setSuccess(true);
        setEmail('');
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to send reset email. Please try again.');
        }
      }
    });
  };

  return (
    <div className="w-full max-w-md">
      <div className="ui-auth-card rounded-3xl p-5 shadow-2xl sm:p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Reset your password</h1>
          <p className="mt-2 text-sm text-slate-400">
            Enter your email address and we’ll send you a link to reset your password.
          </p>
        </div>

        {success ? (
          <div className="ui-alert ui-alert-success rounded-2xl px-4 py-3 text-sm" role="status">
            <p className="font-medium">Check your email</p>
            <p className="mt-1">
              We’ve sent a password reset link to {email}. The link expires in 1 hour.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
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
              {isPending ? 'Sending...' : 'Send reset link'}
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
