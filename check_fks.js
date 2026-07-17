const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://jjhtasppfxunbrswgxht.supabase.co";
const supabaseKey = "sb_publishable_VLtE7wWG9dDGYxfnYdHVGA_IlilKigB";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkReferencedTables() {
  console.log("=== CHECKING FOREIGN KEY REFERENCES FOR SHIFTS ===\n");

  console.log("Shift table needs these to exist:");
  console.log("1. companies(id)");
  console.log("2. employees(id)");
  console.log("3. departments(id) - optional FK");
  console.log("4. profiles(id) - for created_by_id\n");

  const tables = ["companies", "employees", "departments", "profiles"];

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .limit(1);

    if (error?.message.includes("PGRST205")) {
      console.log(`❌ ${table} - MISSING`);
    } else if (error?.message.includes("permission denied")) {
      console.log(`✓ ${table} - EXISTS (RLS/permission issue)`);
    } else if (error) {
      console.log(`? ${table} - ERROR: ${error.message.substring(0, 60)}`);
    } else {
      console.log(`✓ ${table} - EXISTS and has data: ${data?.length || 0} rows`);
    }
  }

  console.log("\n=== HYPOTHESIS ===");
  console.log("If all 4 tables exist, then CREATE TABLE shifts should succeed.");
  console.log("Since it doesn't exist, the issue is likely:");
  console.log("- A) The CREATE TABLE statement never ran");
  console.log("- B) The CREATE TABLE statement failed due to unrelated reason");
  console.log("- C) A different/older version of the schema was used");
}

checkReferencedTables().catch(console.error);
