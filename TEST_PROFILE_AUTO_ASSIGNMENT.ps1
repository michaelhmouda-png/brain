# Test script for profile auto-assignment fix
# Run this after setting up a test user

Write-Host "=== Testing Profile Auto-Assignment Fix ===" -ForegroundColor Cyan
Write-Host ""

# Check database status
Write-Host "1. Database Status:" -ForegroundColor Yellow
$statusResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/debug/status" -Method Get
$statusResponse | ConvertTo-Json | Write-Host

Write-Host ""
Write-Host "Current State:" -ForegroundColor Yellow
Write-Host "  Companies: $($statusResponse.database.companiesCount) (should be 1)" -ForegroundColor White
Write-Host "  Company ID: $($statusResponse.database.companies[0].id)" -ForegroundColor White
Write-Host "  Company Name: $($statusResponse.database.companies[0].name)" -ForegroundColor White
Write-Host "  Authenticated: $($statusResponse.auth.isAuthenticated)" -ForegroundColor White

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "To test the automatic profile company assignment:" -ForegroundColor White
Write-Host ""
Write-Host "1. Log in with an existing user (or create one via /api/debug/setup-test-user)" -ForegroundColor White
Write-Host ""
Write-Host "2. Navigate to: http://localhost:3000/dashboard/ai-assistant" -ForegroundColor White
Write-Host ""
Write-Host "3. Open browser DevTools → Console tab" -ForegroundColor White
Write-Host ""
Write-Host "4. In the terminal running 'npm run dev', look for these logs:" -ForegroundColor White
Write-Host ""
Write-Host "   If profile had NULL company_id (RLS blocked access):" -ForegroundColor Green
Write-Host "     [Brain Chat] RLS policy blocking profile access" -ForegroundColor Green
Write-Host "     [Brain Chat] Bootstrap: Assigning company <UUID> to user profile" -ForegroundColor Green
Write-Host ""
Write-Host "   If profile was created but missing:" -ForegroundColor Green
Write-Host "     [Brain Chat] Profile does not exist. Creating..." -ForegroundColor Green
Write-Host ""
Write-Host "   If all succeeded:" -ForegroundColor Green
Write-Host "     [Brain Chat] Company ID validation PASSED:" -ForegroundColor Green
Write-Host ""
Write-Host "5. Try creating an employee via the AI assistant:" -ForegroundColor White
Write-Host "   'Create an employee named John Doe, job title Manager'" -ForegroundColor White
Write-Host ""
Write-Host "Expected Results:" -ForegroundColor Cyan
Write-Host "  ✓ User's profile company_id is automatically set to Rikky'z company ID" -ForegroundColor Green
Write-Host "  ✓ No more 'User profile missing valid company_id' errors" -ForegroundColor Green
Write-Host "  ✓ Employee creation succeeds with correct company context" -ForegroundColor Green
Write-Host "  ✓ Server logs show: [Brain Chat] Insert object: {...company_id: valid-uuid...}" -ForegroundColor Green
