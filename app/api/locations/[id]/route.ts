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
    company_id: body.company_id,
    name: body.name,
    type: body.type,
    country: body.country,
    city: body.city,
    address: body.address ?? null,
    timezone: body.timezone,
    phone: body.phone ?? null,
    email: body.email ?? null,
    capacity: Number(body.capacity ?? 0),
    status: body.status ?? "active",
  };

  const { data, error } = await supabaseAuth
    .from("locations")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { error } = await supabaseAuth.from("locations").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: "Location deleted." }, { status: 200 });
}
