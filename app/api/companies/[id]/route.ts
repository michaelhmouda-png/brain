import { NextResponse } from "next/server";
import { createSupabaseServerAuth } from "../../../../lib/supabaseServer";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const body = await request.json();
  const { id } = await params;
  
  // Use authenticated client (respects RLS)
  const supabaseAuth = await createSupabaseServerAuth();
  
  // Verify user is authenticated
  const {
    data: { user },
    error: authError,
  } = await supabaseAuth.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const updates = {
    name: body.name,
    logo_url: body.logo_url ?? null,
    industry: body.industry,
    country: body.country,
    currency: body.currency,
    timezone: body.timezone,
    locations: Number(body.locations),
  };

  const { data, error } = await supabaseAuth
    .from("companies")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}
