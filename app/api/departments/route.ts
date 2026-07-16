import { NextResponse } from "next/server";
import { createSupabaseServer } from "../../../lib/supabaseServer";

export async function POST(request: Request) {
  const body = await request.json();
  const requiredFields = ["company_id", "name"];

  for (const field of requiredFields) {
    if (!body[field]) {
      return NextResponse.json({ message: `${field} is required.` }, { status: 400 });
    }
  }

  const payload = {
    company_id: body.company_id,
    location_id: body.location_id ?? null,
    name: body.name,
    description: body.description ?? null,
    manager_employee_id: body.manager_employee_id ?? null,
    status: body.status ?? "active",
  };

  const supabaseServer = createSupabaseServer();
  const { data, error } = await supabaseServer.from("departments").insert(payload).select().single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
