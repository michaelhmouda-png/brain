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
    location_id: body.location_id ?? null,
    department_id: body.department_id ?? null,
    first_name: body.first_name,
    last_name: body.last_name,
    role: body.role,
    phone: body.phone ?? null,
    email: body.email ?? null,
    employment_type: body.employment_type ?? "full-time",
    salary: Number(body.salary ?? 0),
    hire_date: body.hire_date ?? null,
    status: body.status ?? "active",
    notes: body.notes ?? null,
  };

  const { data, error } = await supabaseAuth
    .from("employees")
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

  const { error } = await supabaseAuth.from("employees").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: "Employee deleted." }, { status: 200 });
}
