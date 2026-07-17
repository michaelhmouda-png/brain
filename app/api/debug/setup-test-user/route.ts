import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * TEMPORARY DEBUG ENDPOINT - Creates test users for local testing
 * This endpoint uses the service role key to bypass auth
 * Should only exist in development
 */
export async function POST(request: Request) {
  // Check if we have service role key (required for user creation)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json(
      { 
        error: 'SUPABASE_SERVICE_ROLE_KEY not configured',
        instructions: 'Set SUPABASE_SERVICE_ROLE_KEY in .env.local to enable user creation',
      },
      { status: 500 }
    );
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_SUPABASE_URL not configured' }, { status: 500 });
    }

    // Create admin client with service role key (bypasses auth)
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get request body
    const body = await request.json();
    const { email, password, fullName = 'Test User' } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'email and password are required' },
        { status: 400 }
      );
    }

    console.log('[Setup] Creating test user:', email);

    // 1. Create auth user
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
    });

    if (userError) {
      console.error('[Setup] User creation failed:', userError.message);
      return NextResponse.json({ error: userError.message }, { status: 400 });
    }

    if (!userData.user) {
      return NextResponse.json({ error: 'User creation returned no user' }, { status: 500 });
    }

    const userId = userData.user.id;
    console.log('[Setup] User created:', userId);

    // 2. Get a company to assign
    const authenticatedSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: companies, error: companiesError } = await authenticatedSupabase
      .from('companies')
      .select('id')
      .limit(1);

    if (companiesError || !companies || companies.length === 0) {
      return NextResponse.json(
        { error: 'No companies found in database. Create a company first.' },
        { status: 400 }
      );
    }

    const companyId = companies[0].id;
    console.log('[Setup] Assigning company:', companyId);

    // 3. Create profile with auto-assigned company
    const { data: profile, error: profileError } = await authenticatedSupabase
      .from('profiles')
      .insert({
        id: userId,
        full_name: fullName,
        role: 'manager', // Default role for testing
        status: 'active',
        company_id: companyId,
      })
      .select()
      .single();

    if (profileError) {
      console.error('[Setup] Profile creation failed:', profileError.message);
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    console.log('[Setup] Profile created:', profile);

    return NextResponse.json({
      success: true,
      user: {
        id: userId,
        email,
      },
      profile: {
        id: profile.id,
        company_id: profile.company_id,
        role: profile.role,
        status: profile.status,
      },
      instructions: `Test user created! You can now log in with:\nEmail: ${email}\nPassword: ${password}`,
    });
  } catch (error) {
    console.error('[Setup] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
