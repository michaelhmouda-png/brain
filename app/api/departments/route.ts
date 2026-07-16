import { NextResponse } from "next/server";
import { createSupabaseServerAuth } from "../../../lib/supabaseServer";

export async function POST(request: Request) {
  const body = await request.json();
  const requiredFields = ["company_id", "name"];

  for (const field of requiredFields) {
    if (!body[field]) {
      return NextResponse.json({ message: `${field} is required.` }, { status: 400 });
    }
  }

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

  const payload = {
    company_id: body.company_id,
    location_id: body.location_id ?? null,
    name: body.name,
    description: body.description ?? null,
    manager_employee_id: body.manager_employee_id ?? null,
    status: body.status ?? "active",
  };

  const { data, error } = await supabaseAuth.from("departments").insert(payload).select().single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
