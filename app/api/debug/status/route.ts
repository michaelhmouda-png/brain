import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerAuth } from '../../../../lib/supabaseServer';

/**
 * Debug endpoint to check database state and authentication
 * Returns: companies count, user auth status, profile info, table schemas
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerAuth();

    // 1. Get auth user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    console.log('[Debug] Auth result:', { userId: user?.id, authError: authError?.message });

    // 2. Get companies count
    const { data: companies, error: companiesError } = await supabase
      .from('companies')
      .select('id, name', { count: 'exact' });
    console.log('[Debug] Companies:', { count: companies?.length, error: companiesError?.message });

    // 3. Try to query profiles table (will error if it doesn't exist)
    const { data: profiles, error: profilesTableError } = await supabase
      .from('profiles')
      .select('id', { count: 'exact' })
      .limit(1);
    console.log('[Debug] Profiles table check:', {
      exists: profilesTableError?.code !== 'PGRST116', // PGRST116 = "Relation not found"
      error: profilesTableError?.message,
      tableError: profilesTableError?.code,
    });

    // 4. If user is authenticated, get their profile
    let profileData = null;
    let profileError = null;
    if (user?.id) {
      const result = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      profileData = result.data;
      profileError = result.error;
      console.log('[Debug] Profile lookup for user', user.id, ':', {
        profileId: profileData?.id,
        profileCompanyId: profileData?.company_id,
        profileError: profileError?.message,
      });
    }

    return NextResponse.json({
      status: 'ok',
      auth: {
        isAuthenticated: !!user,
        userId: user?.id,
        email: user?.email,
      },
      database: {
        companiesCount: companies?.length || 0,
        companies: companies?.map((c: any) => ({ id: c.id, name: c.name })) || [],
        profilesTableExists: profilesTableError?.code !== 'PGRST116',
        profilesTableError: profilesTableError?.message,
      },
      profile: {
        exists: !!profileData,
        id: profileData?.id,
        company_id: profileData?.company_id,
        full_name: profileData?.full_name,
        role: profileData?.role,
        status: profileData?.status,
        error: profileError?.message,
      },
      instructions: profilesTableError?.code === 'PGRST116' 
        ? 'PROFILES TABLE NOT FOUND. Need to create it with: CREATE TABLE profiles (...)'
        : 'Profiles table exists. If no user is authenticated, use /api/debug/setup-test-user to create one.',
    });
  } catch (error) {
    console.error('[Debug] Error:', error);
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
