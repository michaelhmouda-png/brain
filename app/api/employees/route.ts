import { NextResponse } from "next/server";
import { createSupabaseServer } from "../../../lib/supabaseServer";

export async function POST(request: Request) {
  const body = await request.json();
  const requiredFields = ["company_id", "first_name", "last_name", "role"];

  for (const field of requiredFields) {
    if (!body[field]) {
      return NextResponse.json({ message: `${field} is required.` }, { status: 400 });
    }
  }

  const payload = {
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

  const supabaseServer = createSupabaseServer();
  const { data, error } = await supabaseServer.from("employees").insert(payload).select().single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
