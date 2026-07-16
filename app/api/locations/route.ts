import { NextResponse } from "next/server";
import { createSupabaseServer } from "../../../lib/supabaseServer";

export async function POST(request: Request) {
  const body = await request.json();
  const requiredFields = ["company_id", "name", "type", "country", "city", "timezone"];

  for (const field of requiredFields) {
    if (!body[field]) {
      return NextResponse.json({ message: `${field} is required.` }, { status: 400 });
    }
  }

  const payload = {
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

  const supabaseServer = createSupabaseServer();
  const { data, error } = await supabaseServer.from("locations").insert(payload).select().single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
