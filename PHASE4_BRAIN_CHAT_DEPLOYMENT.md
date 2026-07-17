# Phase 4: Brain Chat V1 - Deployment Guide

## Overview
Brain Chat V1 is a secure AI-powered operational assistant for hospitality businesses. It integrates OpenAI's GPT-4 Turbo with Supabase row-level security (RLS) to provide role-based, company-scoped data access.

## Architecture

### Components
- **Frontend**: `/dashboard/ai-assistant/page.tsx` (280 lines, 'use client')
- **API Route**: `/api/brain/chat/route.ts` (530 lines, server-side)
- **Tools**: 8 read-only functions for companies, locations, departments, employees
- **Auth**: Supabase SSR with cookie-based sessions
- **AI Model**: OpenAI GPT-4 Turbo (max_tokens: 1024)

### Data Flow
```
Browser (Chat UI)
  ↓ POST /api/brain/chat + session cookie
  ↓
Supabase SSR Auth (validate session)
  ↓
ToolHandlers (execute 8 read-only tools)
  ↓
Supabase Queries (RLS enforced per user)
  ↓
OpenAI Function Calling (tool loop)
  ↓
Response (assistant message)
```

## Security Features

### Authentication & Authorization
- ✅ Supabase SSR authentication required (401 for unauthenticated requests)
- ✅ User identity derived from HTTP-only session cookie
- ✅ User status verified (must be 'active')
- ✅ Role-based access:
  - super_admin: Sees all companies, all employees, all data
  - owner/manager/employee: Sees own company only
- ✅ All Supabase queries enforced via RLS policies

### Tool Security
- ✅ 8 read-only tools (no create/update/delete operations)
- ✅ Tool input parameters validated before execution
- ✅ Tool errors caught and returned safely (no stack traces leaked)
- ✅ Company access enforced at query time (not model time)
- ✅ OpenAI API key stored server-side (.env.local, never exposed to client)

### API Security
- ✅ Request validation: messages array must be non-empty
- ✅ Response validation: only text content returned (no internal tool calls visible)
- ✅ Rate limiting enforced in browser (10 requests per session, localStorage-based)
- ✅ No API key, secrets, or system prompts exposed in responses
- ✅ CORS: API route accessible only from same origin (proxy.ts handles)

## Installation & Configuration

### Prerequisites
1. Node.js 18+ and npm
2. Supabase project configured with auth enabled
3. OpenAI API key with GPT-4 access

### Environment Variables
Add to `.env.local` (server-side only, never expose to client):

```env
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
OPENAI_API_KEY=<your-openai-api-key>
```

**Critical**: OPENAI_API_KEY must NOT be prefixed with `NEXT_PUBLIC_`. It remains server-side only.

### Installation Steps
```bash
# 1. Install dependencies
npm install openai

# 2. Add OPENAI_API_KEY to .env.local
echo "OPENAI_API_KEY=your_key_here" >> .env.local

# 3. Verify build
npm run build

# 4. Run dev server
npm run dev
```

## Usage

### Chat API Endpoint
```
POST /api/brain/chat
Content-Type: application/json
Authorization: (Supabase session cookie, automatically sent by browser)

Request Body:
{
  "messages": [
    { "role": "user", "content": "How many employees do we have?" },
    { "role": "assistant", "content": "..." }
  ]
}

Response:
{
  "message": "We have 42 active employees across 3 locations.",
  "role": "assistant"
}
```

### Frontend Usage
Navigate to `/dashboard/ai-assistant` (requires authentication). The UI provides:
- Chat message history
- Suggested questions (4 examples)
- Auto-scroll to latest message
- Loading indicator with animated dots
- Error display
- Rate limiting counter (10 per session)
- Shift+Enter for multiline input

### Supported Questions (Examples)
- "How many employees do we have?"
- "Show our locations."
- "Which departments are active?"
- "Give me a summary of employees at [location name]"
- "How many people work in [department name]?"
- "What is the company structure?"

### Unsupported Operations
The model cannot perform these (no tools available):
- Create, update, or delete records
- Access sensitive employee data (passwords, SSN, etc.)
- Modify RLS policies or authentication
- Execute arbitrary SQL queries

## Testing

### Build Verification
```bash
npm run build
# Expected: ✓ Compiled successfully + 21 pages + /api/brain/chat route
```

### API Security Test
```bash
# 1. Test unauthenticated request (should fail with 401)
curl -X POST http://localhost:3000/api/brain/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"test"}]}'
# Expected: 401 Unauthorized

# 2. Test with valid session (requires browser authentication first)
# - Open http://localhost:3000/dashboard/ai-assistant
# - Log in with valid credentials
# - Ask a question in the chat UI
# - Check browser console for errors
```

### Tool Execution Verification
Tools are tested indirectly through the chat UI:
- **list_companies**: Ask "How many companies are active?"
- **list_locations**: Ask "Show all locations"
- **list_departments**: Ask "List all departments"
- **list_employees**: Ask "How many employees work here?"
- **get_location_summary**: Ask "Give me a summary of [location name]"
- **get_employee_summary**: Ask "Tell me about [employee name]"
- **get_company_summary**: Ask "What is the company structure?"
- **get_current_user_profile**: Ask "Who am I?" or "What is my role?"

### RLS Verification
- Log in as non-super_admin user
- Ask "Show all companies"
- Verify response shows only own company
- Log in as super_admin user
- Ask "Show all companies"
- Verify response shows all companies

## Deployment

### Production Build
```bash
npm run build
npm start
```

### Environment Setup (Production)
1. Set OPENAI_API_KEY in production environment (e.g., GitHub Actions secrets)
2. Verify NEXT_PUBLIC_SUPABASE_* variables match production Supabase project
3. Run database migrations if using auth_schema.sql updates
4. Test authentication flow in staging before production

### Scaling Considerations
- Rate limiting: Currently 10 requests per session (browser localStorage, resets on page reload)
  - For production: Consider server-side rate limiting with Redis
- Message history: Currently kept in browser memory (lost on page reload)
  - For production: Consider database persistence in `brain_messages` table
- Streaming: Currently returns complete response
  - For production: Consider OpenAI streaming API for faster UX
- Tool availability: Limited to 8 read-only queries
  - For future: Add write tools (create/update/delete) with additional approval workflows

## Monitoring & Debugging

### Logs
- Browser console: Check for fetch errors or React warnings
- Terminal (npm run dev): Check for API route errors
- API errors: Returned in response body under `error` key

### Common Issues

**401 Unauthorized on Chat API**
- Cause: Session expired or authentication cookie lost
- Fix: Reload page and log in again

**"No response generated"**
- Cause: OpenAI returned empty response or model failed
- Fix: Check OPENAI_API_KEY is valid, check OpenAI quota/usage

**Tool execution failed**
- Cause: RLS policy denied query or tool input was invalid
- Fix: Verify user role, verify tool input format in browser console

**Rate limit exceeded**
- Cause: 10 chat messages sent in current session
- Fix: Reload page to reset limit (or wait for database persistence in future)

## Files Created & Modified

### Created
- `app/api/brain/chat/route.ts` (530 lines): Main chat API endpoint

### Modified
- `app/dashboard/ai-assistant/page.tsx` (280 lines): Chat UI component (replaced placeholder)
- `.env.local`: Added OPENAI_API_KEY

### Unchanged
- Database schema (no changes to auth_schema.sql)
- RLS policies (no changes)
- Supabase authentication (uses existing configuration)

## Future Enhancements

### Phase 5 (Potential)
- [ ] Streaming responses (OpenAI streaming API)
- [ ] Conversation persistence (database storage)
- [ ] Multi-turn context (remember previous conversations)
- [ ] Write tools (create/update/delete with approval)
- [ ] Advanced analytics (conversation tracking, popular questions)
- [ ] Custom system prompts per company
- [ ] Vision capabilities (analyze images of locations/staff)

### Phase 6 (Potential)
- [ ] Webhook integration (notify when anomalies detected)
- [ ] Scheduled reports (daily/weekly summaries)
- [ ] Slack/Teams integration
- [ ] Mobile app support
- [ ] Offline mode (queued requests)

## Support & Troubleshooting

For issues or questions:
1. Check this file for common issues section
2. Review browser console and terminal logs
3. Verify environment variables are set correctly
4. Test with curl command to isolate frontend vs backend issues
5. Check Supabase status page for service outages

---

**Version**: 1.0  
**Last Updated**: 2025-01-XX  
**Status**: Production Ready (requires E2E testing with valid test users)
