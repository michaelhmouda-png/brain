import { NextResponse } from "next/server";
import { createSupabaseServer } from "../../../../lib/supabaseServer";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const body = await request.json();
  const { id } = await params;
  const supabaseServer = createSupabaseServer();

  const updates = {
    name: body.name,
    logo_url: body.logo_url ?? null,
    industry: body.industry,
    country: body.country,
    currency: body.currency,
    timezone: body.timezone,
    locations: Number(body.locations),
  };

  const { data, error } = await supabaseServer
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
