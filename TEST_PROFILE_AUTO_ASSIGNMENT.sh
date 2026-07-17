#!/bin/bash
# Test script to verify the profile auto-assignment fix

# This script creates a test user with a NULL company_id and verifies
# that the /api/brain/chat endpoint automatically assigns the company

set -e

echo "=== Testing Profile Auto-Assignment Fix ==="
echo ""

# 1. Get current database status
echo "1. Checking database status..."
curl -s http://localhost:3000/api/debug/status | jq .

echo ""
echo "2. Creating test user with NULL company_id..."
echo ""

# 2. Create a test user (requires SUPABASE_SERVICE_ROLE_KEY)
# This would need to be run through Supabase admin API
# For now, documentation only

echo "===== NEXT STEPS ====="
echo ""
echo "To test the profile auto-assignment fix:"
echo ""
echo "1. Get the Supabase Service Role Key from:"
echo "   https://app.supabase.com → Project Settings → API → Service Role key"
echo ""
echo "2. Update .env.local with:"
echo "   SUPABASE_SERVICE_ROLE_KEY=<your_key_here>"
echo ""
echo "3. Restart dev server"
echo ""
echo "4. Create a test user:"
echo "   curl -X POST http://localhost:3000/api/debug/setup-test-user \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"email\":\"test@example.com\",\"password\":\"testPass123\"}'"
echo ""
echo "5. Log in with that user"
echo ""
echo "6. Open DevTools Console and check server logs for:"
echo "   [Brain Chat] Bootstrap: Assigning company ... to user profile"
echo ""
echo "Expected result:"
echo "  ✓ Profile auto-assigned company_id from Rikky'z company"
echo "  ✓ User can now use AI assistant without company_id errors"
echo "  ✓ Employee creation will work with correct company context"
