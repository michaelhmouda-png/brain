import { NextResponse } from "next/server";
import { createSupabaseServer } from "../../../../lib/supabaseServer";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const body = await request.json();
  const { id } = await params;

  const updates = {
    company_id: body.company_id,
    location_id: body.location_id ?? null,
    name: body.name,
    description: body.description ?? null,
    manager_employee_id: body.manager_employee_id ?? null,
    status: body.status ?? "active",
  };

  const supabaseServer = createSupabaseServer();
  const { data, error } = await supabaseServer
    .from("departments")
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
  const supabaseServer = createSupabaseServer();
  const { error } = await supabaseServer.from("departments").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: "Department deleted." }, { status: 200 });
}
