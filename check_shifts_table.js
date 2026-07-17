const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://jjhtasppfxunbrswgxht.supabase.co";
const supabaseKey = "sb_publishable_VLtE7wWG9dDGYxfnYdHVGA_IlilKigB";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkShiftsTable() {
  console.log("=== Checking public.shifts table ===\n");

  // Check if shifts table exists
  const { data, error } = await supabase
    .from("shifts")
    .select("*")
    .limit(1);

  if (error) {
    console.log("ERROR querying shifts table:");
    console.log("Message:", error.message);
    console.log("Code:", error.code);
    console.log("\n");
  } else {
    console.log("✓ shifts table EXISTS and is accessible");
    console.log("Data:", data);
  }

  // Check open_shifts table
  const { data: data2, error: error2 } = await supabase
    .from("open_shifts")
    .select("*")
    .limit(1);

  if (error2) {
    console.log("\nERROR querying open_shifts table:");
    console.log("Message:", error2.message);
  } else {
    console.log("\n✓ open_shifts table EXISTS and is accessible");
    console.log("Data:", data2);
  }
}

checkShiftsTable().catch(console.error);
