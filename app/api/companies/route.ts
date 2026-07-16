import { NextResponse } from "next/server";
import { createSupabaseServerAuth } from "../../../lib/supabaseServer";

export async function POST(request: Request) {
  const body = await request.json();

  const requiredFields = ["name", "industry", "country", "currency", "timezone", "locations"];
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
    name: body.name,
    logo_url: body.logo_url ?? null,
    industry: body.industry,
    country: body.country,
    currency: body.currency,
    timezone: body.timezone,
    locations: Number(body.locations),
  };

  const { data, error } = await supabaseAuth.from("companies").insert(payload).select().single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
