'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';

export function LoginForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const supabase = getSupabaseBrowserClient();
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message);
        setIsLoading(false);
        return;
      }

      if (!data.user) {
        setError('Login failed: no user returned');
        setIsLoading(false);
        return;
      }

      // Do NOT fetch profile before navigation.
      // Session cookie is now set by @supabase/ssr browser client.
      // Full page navigation ensures proxy.ts sees the cookie.
      console.log('[LoginForm] Login successful, navigating to /dashboard');
      window.location.assign('/dashboard');
    } catch (err) {
      console.error('[LoginForm] Login failed:', err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to sign in. Please check your email and password.');
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-8">
        <div className="mb-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/20">
            <span className="text-3xl font-black tracking-[0.25em]">B</span>
          </div>
          <h1 className="mt-6 text-2xl font-bold text-white">Welcome to Brain</h1>
          <p className="mt-2 text-sm text-slate-400">AI operating system for hospitality</p>
        </div>

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
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-slate-500 transition focus:border-cyan-400/50 focus:bg-white/10 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-slate-500 transition focus:border-cyan-400/50 focus:bg-white/10 focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-2xl bg-cyan-500 px-4 py-3 font-semibold text-white transition hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 border-t border-white/10 pt-6">
          <Link
            href="/forgot-password"
            className="text-sm text-cyan-400 hover:text-cyan-300 transition"
          >
            Forgot your password?
          </Link>
        </div>
      </div>
    </div>
  );
}
