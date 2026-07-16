/**
 * Server-side authentication and data access utilities
 * 
 * These functions use the Supabase client with RLS policies.
 * Always use these functions in server components and API routes.
 * DO NOT expose SUPABASE_SERVICE_ROLE_KEY to the client side.
 */

import { createSupabase } from './supabaseClient';
import type { Profile } from './types';

/**
 * Get the current user from the session
 */
export async function getCurrentUserServer() {
  const supabase = createSupabase();

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      throw new Error(error.message);
    }

    return user;
  } catch (error) {
    console.error('Failed to get current user:', error);
    return null;
  }
}

/**
 * Get the current user's profile from the profiles table
 * This will respect RLS policies
 */
export async function getCurrentUserProfileServer(): Promise<Profile | null> {
  const supabase = createSupabase();

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      throw new Error(userError.message);
    }

    if (!user) {
      return null;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      throw new Error(profileError.message);
    }

    return profile as Profile | null;
  } catch (error) {
    console.error('Failed to get user profile:', error);
    return null;
  }
}

/**
 * Get the current user's company ID
 * Used for filtering queries to respect company isolation
 */
export async function getCurrentUserCompanyId(): Promise<string | null> {
  const profile = await getCurrentUserProfileServer();
  return profile?.company_id || null;
}

/**
 * Check if the current user is a super admin
 */
export async function isCurrentUserSuperAdmin(): Promise<boolean> {
  const profile = await getCurrentUserProfileServer();
  return profile?.role === 'super_admin' || false;
}

/**
 * Check if the current user has manager or owner role
 */
export async function canCurrentUserEdit(): Promise<boolean> {
  const profile = await getCurrentUserProfileServer();
  return (
    profile?.role === 'owner' ||
    profile?.role === 'manager' ||
    profile?.role === 'super_admin' ||
    false
  );
}

/**
 * Check if the current user can perform admin actions
 */
export async function canCurrentUserAdmin(): Promise<boolean> {
  const profile = await getCurrentUserProfileServer();
  return (profile?.role === 'owner' || profile?.role === 'super_admin' || false);
}

/**
 * Fetch companies accessible to the current user
 */
export async function getAccessibleCompanies() {
  const supabase = createSupabase();

  try {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return data || [];
  } catch (error) {
    console.error('Failed to fetch companies:', error);
    return [];
  }
}

/**
 * Fetch locations for the current user's company
 */
export async function getAccessibleLocations() {
  const supabase = createSupabase();
  const companyId = await getCurrentUserCompanyId();

  try {
    let query = supabase.from('locations').select('*');

    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    const { data, error } = await query.order('name', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return data || [];
  } catch (error) {
    console.error('Failed to fetch locations:', error);
    return [];
  }
}

/**
 * Fetch departments for the current user's company
 */
export async function getAccessibleDepartments() {
  const supabase = createSupabase();
  const companyId = await getCurrentUserCompanyId();

  try {
    let query = supabase.from('departments').select('*');

    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    const { data, error } = await query.order('name', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return data || [];
  } catch (error) {
    console.error('Failed to fetch departments:', error);
    return [];
  }
}

/**
 * Fetch employees for the current user's company
 */
export async function getAccessibleEmployees() {
  const supabase = createSupabase();
  const companyId = await getCurrentUserCompanyId();

  try {
    let query = supabase.from('employees').select('*');

    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    const { data, error } = await query.order('first_name', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return data || [];
  } catch (error) {
    console.error('Failed to fetch employees:', error);
    return [];
  }
}
