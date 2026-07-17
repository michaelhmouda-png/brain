const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://jjhtasppfxunbrswgxht.supabase.co";
const supabaseKey = "sb_publishable_VLtE7wWG9dDGYxfnYdHVGA_IlilKigB";

const supabase = createClient(supabaseUrl, supabaseKey);

async function listAllTables() {
  console.log("=== Listing all public tables in Supabase ===\n");

  const { data, error } = await supabase.rpc("list_all_tables");

  if (error) {
    console.log("Error calling list_all_tables RPC:", error.message);
    console.log("\nTrying alternate method - querying information_schema directly...\n");

    // Alternative: Try to determine tables by testing common names
    const commonTables = [
      "shifts",
      "open_shifts",
      "recurring_shifts",
      "shift_templates",
      "companies",
      "employees",
      "departments",
      "profiles",
      "maintenance_tickets",
      "incident_reports",
      "announcements",
    ];

    for (const tableName of commonTables) {
      const { error: e } = await supabase
        .from(tableName)
        .select("*")
        .limit(0);

      if (e && e.message.includes("PGRST205")) {
        console.log(`❌ ${tableName} - DOES NOT EXIST`);
      } else if (e && e.message.includes("permission denied")) {
        console.log(`✓ ${tableName} - EXISTS (RLS permission issue)`);
      } else if (e) {
        console.log(`? ${tableName} - ERROR: ${e.message}`);
      } else {
        console.log(`✓ ${tableName} - EXISTS and accessible`);
      }
    }
  } else {
    console.log("Tables:");
    console.log(JSON.stringify(data, null, 2));
  }
}

listAllTables().catch(console.error);
