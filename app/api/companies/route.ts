import { NextResponse } from "next/server";
import { createSupabaseServer } from "../../../lib/supabaseServer";

export async function POST(request: Request) {
  const body = await request.json();

  const requiredFields = ["name", "industry", "country", "currency", "timezone", "locations"];
  for (const field of requiredFields) {
    if (!body[field]) {
      return NextResponse.json({ message: `${field} is required.` }, { status: 400 });
    }
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

  const supabaseServer = createSupabaseServer();
  const { data, error } = await supabaseServer.from("companies").insert(payload).select().single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
