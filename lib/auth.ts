import { getSupabaseBrowserClient } from './supabaseClient';
import type { Profile } from './types';

export async function loginUser(email: string, password: string) {
  const supabase = getSupabaseBrowserClient();
  console.log('[auth.loginUser] Starting password auth...');

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error('[auth.loginUser] Auth error:', error.message);
    throw new Error(error.message);
  }

  if (!data.user) {
    console.error('[auth.loginUser] No user returned from login');
    throw new Error('No user returned from login');
  }

  console.log('[auth.loginUser] Auth success, user:', data.user.id);
  console.log('[auth.loginUser] Session access_token:', data.session?.access_token ? 'present' : 'null');

  // Fetch the user's profile from the database
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  if (profileError && profileError.code !== 'PGRST116') {
    console.error('[auth.loginUser] Profile fetch error:', profileError);
    throw new Error('Failed to fetch user profile');
  }

  console.log('[auth.loginUser] Profile loaded, status:', profile?.status);
  return { user: data.user, profile: profile as Profile | null };
}

export async function requestPasswordReset(email: string) {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/reset-password`,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function resetPassword(newPassword: string) {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function logoutUser() {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }
}

export async function getCurrentUser() {
  const supabase = getSupabaseBrowserClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw new Error(error.message);
  }

  return user;
}

export async function getCurrentUserProfile(): Promise<Profile | null> {
  const supabase = getSupabaseBrowserClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error('Failed to fetch user profile');
  }

  return profile as Profile | null;
}

export async function getAuthSession() {
  const supabase = getSupabaseBrowserClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session;
}

export async function updateOwnFullName(newFullName: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase.rpc('update_own_full_name', {
    new_full_name: newFullName,
  });

  if (error) {
    throw new Error(error.message || 'Failed to update full name');
  }
}
