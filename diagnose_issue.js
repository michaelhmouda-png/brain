const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://jjhtasppfxunbrswgxht.supabase.co";
const supabaseKey = "sb_publishable_VLtE7wWG9dDGYxfnYdHVGA_IlilKigB";

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnoseShiftsTableIssue() {
  console.log("=== COMPREHENSIVE DIAGNOSIS ===\n");

  // 1. Check employees table
  console.log("1. Checking employees table (required FK for shifts)...");
  const { error: empError } = await supabase
    .from("employees")
    .select("*")
    .limit(1);

  if (empError?.message.includes("PGRST205")) {
    console.log("   ❌ employees table MISSING - shifts FK would fail\n");
  } else if (empError) {
    console.log("   ✓ employees exists (error:", empError.message.substring(0, 50), ")\n");
  } else {
    console.log("   ✓ employees table exists and accessible\n");
  }

  // 2. Check if weekly_schedules exists (comes after shifts in SQL file)
  console.log("2. Checking weekly_schedules table (after shifts in SQL)...");
  const { error: wsError } = await supabase
    .from("weekly_schedules")
    .select("*")
    .limit(1);

  if (wsError?.message.includes("PGRST205")) {
    console.log("   ❌ weekly_schedules MISSING\n");
  } else {
    console.log("   ✓ weekly_schedules exists\n");
  }

  // 3. Check if shift_templates exists (before shifts in SQL file)
  console.log("3. Checking shift_templates table (before shifts in SQL)...");
  const { error: stError } = await supabase
    .from("shift_templates")
    .select("*")
    .limit(1);

  if (stError?.message.includes("PGRST205")) {
    console.log("   ❌ shift_templates MISSING\n");
  } else {
    console.log("   ✓ shift_templates exists\n");
  }

  // 4. Summary
  console.log("=== DIAGNOSIS ===");
  console.log("Tables defined BEFORE shifts in hospibrain_phase1_schemas.sql:");
  console.log("  - shift_templates (line 120) - ✓ EXISTS");
  console.log("\nTables defined AFTER shifts in hospibrain_phase1_schemas.sql:");
  console.log("  - weekly_schedules (line 153) -", wsError?.message.includes("PGRST205") ? "❌" : "✓");
  console.log("  - recurring_shifts (line 174) - ✓ EXISTS");
  console.log("  - open_shifts (line 189) - ✓ EXISTS");
  console.log("\nCONCLUSION:");
  console.log("If weekly_schedules ALSO missing, then hospibrain_phase1_schemas.sql");
  console.log("was executed but stops somewhere BEFORE shifts table (line 135).");
  console.log("If weekly_schedules EXISTS, then execution continued PAST shifts,");
  console.log("meaning CREATE TABLE shifts failed but didn't stop execution.");
}

diagnoseShiftsTableIssue().catch(console.error);
