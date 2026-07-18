# Brain V2: Current Architecture Audit

**Document Date:** 2026-07-17  
**Purpose:** Comprehensive inventory of AI layer architecture for safe V2 migration  
**Scope:** Task tools, conversation context, error handling, authentication, Supabase integration

---

## Executive Summary

**Current State:** Brain V1 has partially working task operations (create works, update/delete have generic errors). The system uses OpenAI GPT-5-Mini with the Responses API and server-side Supabase integration. All AI operations are centralized in a single 5100+ line route handler with inline tool implementations.

**Key Risks:** Monolithic architecture makes V2 implementation risky. Any changes to the central route affect ALL tools (employees, tasks, shifts, maintenance, inventory, customers, brain score, etc.).

**Recommended Approach:** Extract task services to separate layer, keep route.ts unchanged, add new Brain V2 endpoints alongside existing Brain V1 until fully migrated.

---

## 1. AI API Route

### Location
- **File:** `app/api/brain/chat/route.ts`
- **Type:** POST-only API route
- **Deployment:** Server-side only, no client-side AI keys
- **Method:** Next.js Route Handler (App Router)

### Endpoint Details
```typescript
POST /api/brain/chat
Content-Type: application/json

Request Body: {
  messages: Array<{ role: 'user' | 'assistant', content: string }>,
  pendingAction?: { id: string, tool: string, arguments: Record<string, unknown> },
  confirmed?: boolean,
  context?: ConversationContext
}

Response: {
  message: string,
  role: 'assistant',
  pendingAction?: { id, tool, arguments },
  context: ConversationContext
}
```

### Request Flow
1. Browser sends message to `/api/brain/chat`
2. Route handler validates authentication via Supabase session cookies
3. Loads user profile + company_id + role
4. Initializes OpenAI client with API key from `.env.local`
5. Calls OpenAI Responses API with system instructions + TOOLS array
6. Tool loop: if OpenAI returns function_call, execute that tool and feed result back to OpenAI
7. Repeats until OpenAI returns only text (no more function calls)
8. Returns final text message + conversation context to browser

---

## 2. Language Model Provider & SDK

### Provider
- **AI Provider:** OpenAI
- **SDK:** `openai` npm package v6.48.0
- **Model:** `gpt-5-mini` (via Responses API)
- **Tokens:** Max response 1024 tokens

### Client Configuration
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,  // Server-side only
});
```

### API Used
- **Responses API** (not Chat Completions)
- **Tool Format:** Flat array of tool definitions with `type: 'function'`
- **Tool Calling:** Function call loop with synchronous tool execution

### Model Selection Rationale
- **Why gpt-5-mini:** Most cost-effective with fast responses for operational tasks
- **Why Responses API:** Designed for tool-use workflows and multi-turn conversations
- **Why not Chat Completions:** Legacy API, less suitable for complex tool orchestration

---

## 3. Existing AI Prompts

### System Instructions Location
- **Lines:** 4555-4830 in `app/api/brain/chat/route.ts`
- **Type:** Multipart prose instructions embedded directly in code
- **Size:** ~275 lines of detailed natural language specifications

### Prompt Structure
```
1. Core Identity: "You are Brain, the operational intelligence..."
2. Conversation Memory: Recent employees & last mentioned employee
3. Pronoun Resolution: How to map "him", "her", "it" to recent entities
4. Multi-Step Execution: Instructions for handling complex requests
5. Read Operations: How to search employees, tasks, inventory
6. Write Operations: Mandatory confirmation flows for create/update/delete
7. Task Management: Detailed task creation, update, completion workflows
8. Inventory Management: Stock movement recording, reorder logic
9. Customer Management: VIP tracking, interaction recording
10. Brain Score: Health metrics and recommendations
11. Event Preparation: Readiness scoring and task automation
12. Overdue Detection: How to report past-due tasks
13. Plan Editing: Handling "Make it high priority instead" type edits
```

### Key Instructions for Tasks
```
TASK MANAGEMENT OPERATIONS:
- create_task: Auto-resolves employee names, parses natural language dates, maps urgency to priority
- get_tasks: Natural language filtering (e.g., "show overdue", "today's pending")
- update_task: Change status, priority, assignment, due date
- complete_task: Mark task as done
- delete_task: Remove task

CONFIRMATION FLOW:
1. First call with confirmed=false → returns preview
2. Show preview to user
3. User replies "Confirm", "Yes", etc.
4. Second call with confirmed=true → executes

CONVERSATION CONTEXT FOR TASKS:
Remember tasks mentioned in the conversation.
When user refers to "the task", "it", or "that task", resolve to most recently mentioned task.
```

### Critical Issue: Prompt Maintenance
⚠️ **Risk:** System prompt is embedded inline and not version controlled separately. Changes to route.ts affect all AI behavior.

---

## 4. Tool Definitions

### TOOLS Array Location
- **Lines:** 386-1344 in `app/api/brain/chat/route.ts`
- **Format:** Array of OpenAI function definitions
- **Total Tools:** 50+ tools across 8 categories
- **Schema:** OpenAI Responses API format (flat, not nested)

### Task-Related Tools (Subset)
```typescript
{
  type: 'function',
  name: 'create_task',
  description: 'Create a new task in the company...',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '...' },
      description: { type: 'string' },
      assigned_employee_name: { type: 'string' },
      assigned_employee_id: { type: 'string' },
      priority: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
      due_date: { type: 'string' },
      confirmed: { type: 'boolean' },
    },
    required: ['title'],
  },
}
```

### Task Tools Defined
| Tool | Line | Handler | Status |
|------|------|---------|--------|
| `create_task` | 541-580 | `handlers.createTask()` | ✅ Working (preview + confirmation) |
| `get_tasks` | 581-617 | `handlers.getTasks()` | ✅ Working (filtering, search) |
| `update_task` | 618-663 | `handlers.updateTask()` | ⚠️ Partially fixed (context resolution added, needs V2 rework) |
| `complete_task` | 664-677 | `handlers.completeTask()` | ✅ Working |
| `delete_task` | 678-691 | `handlers.deleteTask()` | ✅ Working |

### Tool Coverage by Category
- ✅ Employee Management: 4 tools (list, search, create, get summary)
- ✅ Location/Department: 5 tools (list, summaries)
- ✅ Task Management: 5 tools (create, read, update, complete, delete)
- ✅ Shift Management: 6 tools (create, read, update, delete, list, summaries)
- ✅ Maintenance: 5 tools (create, read, update, complete, delete)
- ✅ Inventory: 5 tools (create, read, movements, update, low-stock)
- ✅ Customers: 3 tools (create, read, interactions)
- ✅ Brain Score: 1 tool (get metrics)

---

## 5. Task Creation, Search, and Update Functions

### File Location
All task functions are in `app/api/brain/chat/route.ts` within the `ToolHandlers` class.

### ToolHandlers Class Structure
```typescript
class ToolHandlers {
  constructor(
    private supabase: SupabaseClient,
    private userCompanyId: string,
    private userRole: string,
    private conversationContext?: ConversationContext
  ) {}
  
  // Task methods
  async createTask(params: CreateTaskInput): Promise<any>
  async getTasks(params: GetTasksInput): Promise<any>
  async updateTask(params: UpdateTaskInput): Promise<any>
  async completeTask(params: CompleteTaskInput): Promise<any>
  async deleteTask(params: DeleteTaskInput): Promise<any>
  
  // Helper methods
  private parseNaturalLanguageDate(dateStr: string): { date: string | null, error: string | null }
  private findEmployeeByName(firstName: string, lastName?: string): Promise<{ id: string, first_name: string, last_name: string } | null>
}
```

### createTask() — Lines 1985-2410

**Status:** ✅ **FULLY WORKING**

**Key Features:**
- Employee name resolution (case-insensitive, partial match, handles multiple matches)
- Natural language date parsing ("today", "tomorrow", "Friday", ISO dates)
- Urgency to priority mapping ("urgent" → Critical, "important" → High)
- Multi-stage validation:
  1. Resolve employee
  2. Parse date
  3. Map priority
  4. Generate preview (if confirmed=false)
  5. Re-validate auth before insert
  6. Verify employee belongs to company
  7. Pre-insert RLS context verification
  8. Access token check
  9. Profile + company verification
  10. Execute insert
  11. Return success with human-readable message

**Database Schema Used:**
- Table: `public.tasks`
- Columns: `id, company_id, title, description, priority, status, created_by, assigned_employee_id, due_date, created_at, updated_at`
- RLS Policies: Enforces `company_id` match for all operations

**Return Format:**
```typescript
{
  success: true,
  id: uuid,
  title: string,
  priority: string,
  status: string,
  assigned_to: string,  // Human-readable name
  due_date: string,
  message: string,      // Natural language confirmation
}
```

**Error Handling:**
- Returns `{ error: string }` with specific error message for each failure scenario
- Logs all validation steps with `[Brain Chat]` prefix
- Includes database error code/hint when applicable

---

### getTasks() — Lines 2411-2498

**Status:** ✅ **FULLY WORKING**

**Supported Filters:**
- `status`: 'Pending', 'In Progress', 'Completed'
- `priority`: 'Low', 'Medium', 'High', 'Critical'
- `due_date`: specific date, 'today', 'tomorrow', 'overdue'
- `assigned_employee_name`: partial match (client-side)
- `limit`: max results (default 20, max 100)

**Query Logic:**
1. Base query: SELECT from tasks WHERE company_id = userCompanyId
2. Apply status filter if provided
3. Apply priority filter if provided
4. Apply due_date filter (with special handling for "overdue")
5. Execute query with ORDER BY due_date ASC
6. Client-side filter by employee name (partial match)
7. Map database fields to display format

**Return Format:**
```typescript
{
  tasks: Array<{
    id: string,
    title: string,
    description: string,
    priority: string,
    status: string,
    due_date: string,
    assigned_to: string,  // "FirstName LastName" or "Unassigned"
  }>,
  count: number,
}
```

**Added in V1.1 - Context Update:**
- After getTasks returns results, first task is stored in `conversationContext.lastMentionedTaskId`
- Enables pronoun resolution for following commands ("Make it critical")

---

### updateTask() — Lines 2491-2610

**Status:** ⚠️ **PARTIALLY FIXED (V1.1 improvements, still needs V2 rework)**

**Recent Improvements (V1.1):**
- ✅ Resolves task ID from `lastMentionedTaskId` if not provided
- ✅ Normalizes priority values (any case → 'Low'/'Medium'/'High'/'Critical')
- ✅ Normalizes status values (any case → 'Pending'/'In Progress'/'Completed')
- ✅ Preserves Supabase error messages instead of generic fallback
- ✅ Logs all operations with `[Task Update]` prefix
- ✅ Employee name resolution when reassigning

**Remaining Issues:**
- ❌ No confirmation preview flow (unlike createTask)
- ❌ No preview mode / confirmed parameter support
- ❌ No pre-update RLS context verification (like createTask has)
- ❌ No access token check before update
- ❌ No re-authentication verification
- ❌ Doesn't update context with new task state
- ❌ Missing complex validation checks that createTask has

**Current Implementation:**
```typescript
// Simplified flow:
1. Try to resolve task ID (explicit or from context)
2. Normalize priority/status values
3. Resolve employee name if reassigning
4. Build update object with only provided fields
5. Execute UPDATE with company_id check only (minimal RLS verification)
6. Return success or error
```

**Database Schema Used:**
- Table: `public.tasks`
- UPDATE targets: id + company_id (RLS enforced for WHERE clause only)
- Fields updateable: title, description, priority, status, due_date, assigned_employee_id

**Return Format:**
```typescript
{
  success: true,
  task: {
    id: string,
    title: string,
    status: string,
    priority: string,
    assigned_to: string,
    due_date: string,
  },
  message: string,
} 
// OR
{
  success: false,
  error: string,
  code?: string,
  details?: string,
}
```

**Error Scenarios:**
- Task ID missing and no context: Returns helpful error asking to specify task
- Task not found: Returns "Task ... was not found"
- Employee not found: Returns "Employee ... not found"
- No fields to update: Returns error
- Supabase errors: Preserves error message + code + details

---

### completeTask() — Lines 2611-2645

**Status:** ✅ **FULLY WORKING**

**Function:**
- Marks task status as 'completed'
- Sets completed_at timestamp
- Accepts optional completion_notes

**Simple Implementation:**
```typescript
// Set status = 'completed', completed_at = NOW()
UPDATE tasks SET status = 'completed', completed_at = NOW()
WHERE id = taskId AND company_id = userCompanyId
```

---

### deleteTask() — Lines 2646-2680

**Status:** ✅ **FULLY WORKING**

**Function:**
- Soft or hard delete (depends on schema)
- Returns confirmation message

**Implementation:**
```typescript
DELETE FROM tasks WHERE id = taskId AND company_id = userCompanyId
```

---

## 6. Supabase Client Creation

### Server-Side Supabase Clients

#### createSupabaseServerAuth() — Location: `lib/supabaseServer.ts` Lines 27-50

**Purpose:** Authenticated Supabase client for AI route (respects user's RLS)

**Method:**
```typescript
export async function createSupabaseServerAuth(): Promise<SupabaseClient> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  
  const cookieStore = await cookies();
  
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) { /* set cookies */ },
    },
  });
}
```

**Key Details:**
- Uses `@supabase/ssr` for proper Next.js SSR cookie handling
- Reads authentication session from HTTP cookies
- Forwards authenticated session to Supabase
- **Critically:** Respects RLS policies — users can only access data allowed by policies

**Used in:** `/api/brain/chat` route handler at line 4256

#### createSupabaseServer() — Location: `lib/supabaseServer.ts` Lines 3-23

**Purpose:** Admin client that bypasses RLS (service role key)

**⚠️ Risk:** Currently NOT used in Brain chat route (good — would violate data isolation)

---

### Client Lifecycle in /api/brain/chat

```typescript
// 1. Request received at /api/brain/chat POST
const request: NextRequest = ...;

// 2. Get authenticated user via cookies
const supabase = await createSupabaseServerAuth();  // Respects cookies
const { data: { user } } = await supabase.auth.getUser();

// 3. Load user profile + company_id
const { data: profile, error: profileError } = await supabase
  .from('profiles')
  .select('id, full_name, role, status, company_id')
  .eq('id', user.id)
  .single();

// 4. Validate company_id
const companyId = profile.company_id;  // Must be non-null UUID

// 5. Pass to ToolHandlers
const handlers = new ToolHandlers(supabase, companyId, profile.role);

// 6. Tools use this.supabase for all queries
// All queries automatically respect RLS because authenticated user's session is embedded
```

---

## 7. Authentication, Organization ID, and Venue ID Resolution

### Authentication Flow

**Entry Point:** Line 4160 in route.ts

```typescript
// 1. Extract auth session from cookies (via createSupabaseServerAuth)
const supabase = await createSupabaseServerAuth();
const { data: { user }, error: userError } = await supabase.auth.getUser();

if (!user) {
  return NextResponse.json(
    { error: 'Not authenticated. Please sign in.' },
    { status: 401 }
  );
}
```

**Session Details:**
- Stored in HTTP-only cookies (automatic with Supabase)
- Contains: user ID, email, access token, refresh token
- Expires: Based on Supabase session settings
- Validated: Every API call

---

### Organization ID Resolution

**Also called:** "Company ID"

**Resolution Path:**
```typescript
// 1. Get user profile
const { data: profile } = await supabase
  .from('profiles')
  .select('id, full_name, role, status, company_id')
  .eq('id', user.id)
  .single();

// 2. Extract company_id from profile
const companyId = profile.company_id;

// 3. Validate (must be non-empty UUID)
if (!companyId || typeof companyId !== 'string' || !companyId.trim()) {
  return NextResponse.json(
    { error: 'User profile missing valid company_id. Contact administrator.' },
    { status: 400 }
  );
}

// 4. Store in route context
const handlers = new ToolHandlers(supabase, companyId, profile.role);
```

**Data Structure:** Line 201 in route.ts
```typescript
interface ConversationContext {
  recentEmployees: Array<{...}>;
  lastMentionedEmployeeId: string | null;
  lastMentionedDepartmentId: string | null;
  recentTasks: Array<{...}>;
  lastMentionedTaskId: string | null;
  lastMentionedTaskTitle: string | null;
}
```

---

### Venue ID Resolution

**Status:** ❌ **NOT CURRENTLY USED**

**Note:** Current schema uses only `company_id` for data isolation. There is no separate "venue" or "location" ID used for scoping the AI operations.

**Locations are:**
- Referenced in employee profiles (optional FK to locations table)
- Tracked for inventory storage locations
- Displayed in summaries
- But NOT used to scope AI operations — all tools see all company data

**Potential for V2:**
- Could add location-scoping if multi-location companies need role-based access by venue
- Would require: user profile has location_id FK, all queries add `.eq('location_id', userLocationId)`

---

## 8. Conversation Context Storage

### ConversationContext Interface

**Location:** Lines 74-93 in route.ts

**Design:** Flattened structure (not nested), with recent entities + last mentioned

```typescript
interface ConversationContext {
  recentEmployees: Array<{
    id: string;
    firstName: string;
    lastName: string;
    fullName: string;
    role: string;
    department?: string;
    departmentId?: string | null;
    locationId?: string | null;
    email?: string;
    phone?: string;
  }>;
  lastMentionedEmployeeId: string | null;
  lastMentionedDepartmentId: string | null;
  
  // Added in V1.1 (Task support)
  recentTasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    assignedToId?: string | null;
    assignedToName?: string;
    dueDate?: string;
  }>;
  lastMentionedTaskId: string | null;
  lastMentionedTaskTitle: string | null;
}
```

### Context Initialization

**Line 4306-4313:**
```typescript
let conversationContext: ConversationContext = requestBody.context || {
  recentEmployees: [],
  lastMentionedEmployeeId: null,
  lastMentionedDepartmentId: null,
  recentTasks: [],
  lastMentionedTaskId: null,
  lastMentionedTaskTitle: null,
};
```

### Context Population

**Employees — Lines 4429-4461:**
- After `createEmployee`: Stores new employee in recentEmployees
- After `getEmployees`: Stores returned employees in recentEmployees
- Keeps most recent 10 employees
- Updates lastMentionedEmployeeId to most recent

**Tasks — Lines 5095-5126 (added in V1.1):**
- After `getTasks`: Stores all returned tasks in recentTasks, first task becomes lastMentionedTaskId
- After `createTask`: Stores created task as lastMentionedTaskId
- After `updateTask`: Updates lastMentionedTaskId + lastMentionedTaskTitle
- Keeps most recent 10 tasks

### Context Transmission

**Request:** Sent by browser in conversation messages array + context object
```typescript
const requestBody = {
  messages: [...],
  context: {
    recentEmployees: [...],
    lastMentionedEmployeeId: "uuid...",
    recentTasks: [...],
    lastMentionedTaskId: "uuid...",
    ...
  }
}
```

**Response:** Returned by API in JSON response
```typescript
return NextResponse.json({
  message: "...",
  role: "assistant",
  context: conversationContext,  // Updated context
  pendingAction?: {...}
});
```

---

## 9. Error Handling — Generic Messages

### Generic Error Messages (Antipattern) — Locations & Status

#### ⚠️ "Task system unavailable" Type Messages

**Original Status:** Present in V1 (users saw "I can't reach the task system right now")

**Now Fixed in V1.1:**
- createTask: All errors preserve actual error message
- getTasks: Returns specific error from database
- updateTask: Now preserves Supabase error (was: "Failed to update task")
- completeTask: ✅ Specific errors
- deleteTask: ✅ Specific errors

**Remaining Generic Messages:** Lines 1371-1330 (general tools)
```typescript
// Example from earlier code (non-task):
return { error: 'Failed to retrieve employees.' };  // Too generic
```

### Current Error Handling Best Practices

**In createTask (GOOD EXAMPLE):**
```typescript
if (insertError) {
  console.error('[Brain Chat] ✗ Task insert FAILED — full Supabase error:');
  console.error('  message:', insertError.message);
  console.error('  code:', insertError.code);
  console.error('  details:', insertError.details);
  console.error('  hint:', insertError.hint);

  return {
    error: `Task insert failed: ${insertError.message}${insertError.hint ? ` (hint: ${insertError.hint})` : ''}`,
  };
}
```

**In updateTask (RECENTLY FIXED):**
```typescript
if (updateError) {
  console.error('[Task Update] Supabase error:', {
    message: updateError.message,
    code: (updateError as any).code,
    details: (updateError as any).details,
    hint: (updateError as any).hint,
  });

  return {
    success: false,
    error: updateError.message || 'Failed to update task in database.',
    code: (updateError as any).code,
    details: (updateError as any).details,
  };
}
```

---

## 10. Duplicate Task Services or Conflicting Implementations

### Audit Result: ✅ **NO DUPLICATES FOUND**

**Task Operations Centralized:**
- ✅ Single `ToolHandlers` class in `/api/brain/chat/route.ts`
- ✅ No separate `lib/task.ts` service file
- ✅ No `/api/tasks/` REST endpoints (tasks only via AI chat)
- ✅ No duplicate task tables (single `public.tasks` table)

**Potential Conflicts:**
- ❌ None identified
- All task operations go through unified AI handler

**Advantage:** Simple, no duplication
**Disadvantage:** Monolithic - any change affects all AI operations

---

## 11. Current Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser: /dashboard/ai-assistant                                │
│ - Sends message + context                                        │
│ - Displays confirmation cards                                    │
│ - Sends pendingAction with confirmed=true                        │
└────────────────────────┬────────────────────────────────────────┘
                         │ POST /api/brain/chat
                         │
┌────────────────────────▼────────────────────────────────────────┐
│ /api/brain/chat Route Handler (route.ts: 5100+ lines)           │
│                                                                   │
│ 1. Extract auth from cookies → user ID                          │
│ 2. Load profile → company_id                                    │
│ 3. Initialize OpenAI client                                     │
│ 4. Call OpenAI Responses API with TOOLS array                   │
│                                                                   │
│ 5. Tool Loop:                                                    │
│    ├─ If function_call → match tool name                         │
│    ├─ Create ToolHandlers instance                              │
│    ├─ Call handlers.toolName(arguments)                         │
│    ├─ Get result (or pendingAction preview)                     │
│    ├─ Send result back to OpenAI                                │
│    └─ Repeat until no more function_calls                       │
│                                                                   │
│ 6. Update conversation context (last mentioned entities)        │
│ 7. Return final text message + context to browser               │
└────────────────────────┬────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ ToolHandlers │ │  OpenAI API  │ │  Supabase    │
│              │ │              │ │              │
│ • createTask │ │ • gpt-5-mini │ │ • Queries    │
│ • getTasks   │ │ • Function   │ │ • Updates    │
│ • updateTask │ │   calling    │ │ • RLS        │
│ • ...        │ │ • Tool loop  │ │   enforcement│
└──────────────┘ └──────────────┘ └──────────────┘
```

---

## 12. Why createTask Works vs updateTask Fails (Before V1.1)

### createTask ✅ — Working

**Reasons for Success:**
1. **Confirmation Flow:** Calls twice (preview, then confirmed) — catches issues early
2. **Deep Validation:** 10+ validation checkpoints (pre-insert diagnostics)
3. **Pre-insert Verification:** Checks auth, access token, profile, company match
4. **Error Preservation:** Logs full Supabase error + code + details
5. **Explicit Confirmation:** Operator reviews before data modified
6. **Context Updates:** Stores created task for future pronoun resolution

**Example:** "Create a task for Maroun to clean the bar"
```
Request 1: create_task with confirmed=false
→ Resolves "Maroun" → validates exists → returns preview
← User sees: "Please confirm: Task 'Clean the bar' assigned to Maroun..."

Request 2: User says "Confirm" → create_task with confirmed=true
→ Re-validates auth + company + employee
→ Executes INSERT
→ Stores in context: lastMentionedTaskId = new_task_id
← User sees: "Task created successfully"

Request 3: User says "Make it critical"
→ update_task called
→ Uses lastMentionedTaskId from context (no explicit ID needed!)
→ Updates to Critical
← Success
```

### updateTask ❌ — Was Failing (Before V1.1)

**Original Problems:**
1. **No Confirmation Flow:** Executed immediately, no chance to review
2. **Minimal Validation:** Only checked basic UUID format
3. **Generic Error Message:** Swallowed Supabase errors → "Failed to update task"
4. **No Context Usage:** Required explicit task ID, couldn't resolve "it"
5. **No Error Details:** User had no way to know why update failed

**Example:** "Make it critical"
```
Request: update_task(priority='Critical')
→ No task_id provided
→ No context available → "Task could not be identified"
← User sees: "I can't reach the task system right now" (WRONG!)

OR

Request: update_task(task_id='wrong-id', priority='Critical')
→ Finds no task matching ID + company
→ Returns generic error: "Failed to update task"
← User sees same unhelpful message
```

### V1.1 Fixes Applied

1. ✅ **Context Resolution:** Checks `lastMentionedTaskId` from context
2. ✅ **Value Normalization:** Converts "high" → "High", "in progress" → "In Progress"
3. ✅ **Error Preservation:** Returns actual Supabase error message
4. ✅ **Detailed Logging:** Logs tool invocation + payload + results
5. ✅ **Helpful Errors:** "Task could not be identified..." guides user

**Remaining Issues for V2:**
- ❌ No confirmation preview flow (should it have one like createTask?)
- ❌ No deep pre-update validation (should match createTask rigor)
- ❌ No context update on success (should update lastMentionedTaskId)
- ❌ No access token verification

---

## 13. Code That Should Be Kept

### Essential, Stable, Untouched

- ✅ **Authentication Flow** (lines 4160-4350): User + profile + company validation
- ✅ **OpenAI Client Init** (line 4358-4360): SDK initialization
- ✅ **Supabase Client** (line 4256): createSupabaseServerAuth() integration
- ✅ **Confirmation Intercept Logic** (lines 5038-5075): Preview handling
- ✅ **Tool Loop Architecture** (lines 4876-5100): Function calling + result handling
- ✅ **Conversation Context** (lines 4306-4313 init, 5095-5126 update): Entity tracking
- ✅ **createTask() Function** (lines 1985-2410): Complete implementation with deep validation
- ✅ **getTasks() Function** (lines 2411-2489): Filtering + search logic
- ✅ **completeTask(), deleteTask()** (lines 2611-2680): Simple state changes
- ✅ **System Instructions** (lines 4555-4830): Detailed natural language guidance
- ✅ **TOOLS Array** (lines 386-1344): Tool definitions (especially task tools)
- ✅ **Employee Tools** (various): getEmployees, createEmployee, etc.
- ✅ **Shift Tools** (various): All shift operations
- ✅ **Maintenance Tools** (various): All maintenance operations
- ✅ **Inventory Tools** (various): All inventory operations

---

## 14. Code That Should Be Replaced/Extracted in V2

### Extract into Separate Services

**Option A: Extract to lib/brain/ submodules** (Recommended for Phase 1)
```
lib/brain/tasks/
  ├─ service.ts          // createTask, getTasks, updateTask, etc.
  ├─ validation.ts       // Pre-insert checks, value normalization
  ├─ context-resolver.ts // Task ID resolution from context
  ├─ employee-resolver.ts// Employee name → ID lookup
  └─ error-handler.ts    // Consistent error formatting

lib/brain/employees/
  ├─ service.ts
  └─ ...

lib/brain/common/
  ├─ supabase-utils.ts   // RLS context verification
  └─ logger.ts           // Consistent logging
```

**Option B: Keep in route.ts but refactor class** (if extraction is risky)
```
Split ToolHandlers into:
  ├─ TaskHandlers extends BaseHandlers
  ├─ EmployeeHandlers extends BaseHandlers
  ├─ ShiftHandlers extends BaseHandlers
  └─ BaseHandlers (shared auth + RLS logic)
```

### Deprecate (Don't Delete Yet)

- ⚠️ **updateTask() in current form:** Keep v1 for backward compatibility, add TaskHandlers.updateTask() as v2
- ⚠️ **System instructions embed:** Extract to separate file (brain.system-prompt.md) once V2 is proven

---

## 15. Risks That Could Affect Other Applications

### Data Isolation Risks

**Risk:** RLS bypass or misconfiguration
- **Impact:** All users could see all company data (or vice versa)
- **Mitigation:** All queries already use `.eq('company_id', userCompanyId)`
- **V2 Check:** Must maintain this pattern in extracted services

### Authentication Risks

**Risk:** Session hijacking or cookie manipulation
- **Impact:** Users could access data from other companies
- **Mitigation:** Cookies are HTTP-only, authenticated session verified per request
- **V2 Check:** Do NOT weaken auth checks in V2 version

### Tool Invocation Risks

**Risk:** OpenAI hallucinating tool calls or misinterpreting intent
- **Impact:** User commands accidentally executed (e.g., "delete all tasks" instead of "view tasks")
- **Mitigation:** Mandatory confirmation flow for create/update/delete
- **V2 Check:** Must preserve confirmation flow for write operations

### Performance Risks

**Risk:** Tool loop timeout with many function calls
- **Impact:** User gets "timeout" instead of response
- **Mitigation:** Max 1024 response tokens per turn limits function calls
- **V2 Check:** Monitor tool call depth in metrics

### Database Schema Changes

**Risk:** If tasks table schema changes, AI layer breaks
- **Impact:** updateTask field mapping fails, inserts fail
- **Mitigation:** Schema is stable (no changes planned)
- **V2 Check:** Document schema assumptions in extracted services

---

## 16. Proposed Minimal Migration Path for Phase 1: Tasks

### Goal
Extract task tools to separate service layer while keeping route.ts stable. Enable progressive testing and rollback.

### Phase 1: Extract Task Service

**Step 1:** Create new file `lib/brain/tasks/service.ts`
```typescript
export class TaskService {
  constructor(
    private supabase: SupabaseClient,
    private userCompanyId: string,
    private conversationContext: ConversationContext
  ) {}
  
  async createTask(params: CreateTaskInput): Promise<any>
  async getTasks(params: GetTasksInput): Promise<any>
  async updateTask(params: UpdateTaskInput): Promise<any>
  async completeTask(params: CompleteTaskInput): Promise<any>
  async deleteTask(params: DeleteTaskInput): Promise<any>
}
```

**Step 2:** Copy implementations from ToolHandlers into TaskService
- createTask() lines 1985-2410 → TaskService.createTask()
- getTasks() lines 2411-2489 → TaskService.getTasks()
- updateTask() lines 2491-2610 → TaskService.updateTask()
- completeTask() lines 2611-2645 → TaskService.completeTask()
- deleteTask() lines 2646-2680 → TaskService.deleteTask()

**Step 3:** Update ToolHandlers to delegate
```typescript
class ToolHandlers {
  private taskService: TaskService;
  
  constructor(supabase, userCompanyId, userRole, conversationContext) {
    this.taskService = new TaskService(supabase, userCompanyId, conversationContext);
  }
  
  async createTask(params) {
    return this.taskService.createTask(params);
  }
  
  async getTasks(params) {
    return this.taskService.getTasks(params);
  }
  
  // ... etc
}
```

**Step 4:** Test with existing route.ts (no user-facing changes)
- `/api/brain/chat` still works identically
- Tool results identical to before
- Only internal organization changed

**Step 5:** Add V2 endpoint alongside V1
```
/api/brain/chat      → Uses ToolHandlers (delegates to TaskService)
/api/brain-v2/chat   → (Future) New implementation with enhanced task system
```

### Phase 2: Enhance Task Service for V2

Once Phase 1 is stable:

**Add to TaskService:**
- Task description quality scoring
- Deadline conflict detection
- Team capacity analysis
- Smart task prioritization
- Multi-task transactions
- Task dependencies
- Recurring task templates

**Add separate utilities:**
- `lib/brain/tasks/validation.ts` — Pre-update checks, RLS verification
- `lib/brain/tasks/context-resolver.ts` — Task ID resolution, fuzzy matching
- `lib/brain/tasks/error-handler.ts` — Consistent error formatting
- `lib/brain/tasks/logger.ts` — Detailed operation logging

### Phase 3: Deprecate V1, Activate V2

Once V2 is tested and proven:
- Redirect `/api/brain/chat` to `/api/brain-v2/chat`
- Archive old `ToolHandlers` class
- Retire V1 system prompt
- Celebrate! 🎉

---

## 17. Summary Table: What Works vs What's Broken

| Component | Status | Notes |
|-----------|--------|-------|
| Authentication | ✅ Working | Session cookies properly validated |
| Company isolation | ✅ Working | RLS policies enforced on all queries |
| OpenAI integration | ✅ Working | Responses API with gpt-5-mini |
| Tool definitions | ✅ Working | 50+ tools registered and callable |
| Task creation | ✅ Working | Full validation + confirmation flow |
| Task search/read | ✅ Working | Filtering + search + context storage |
| Task completion | ✅ Working | Simple status update |
| Task deletion | ✅ Working | Simple delete |
| Task update | ⚠️ Partially working | V1.1: Added context resolution + error preservation, still missing confirmation flow + deep validation |
| Task context memory | ✅ Partially working | Stores last mentioned task, used for pronoun resolution |
| Generic error messages | ⚠️ Mostly fixed | createTask, getTasks, updateTask now preserve real errors |
| Employee tools | ✅ Working | Full CRUD + search |
| Shift tools | ✅ Working | Full CRUD (uses correct public.shifts table) |
| Maintenance tools | ✅ Working | Full CRUD + status workflow |
| Inventory tools | ✅ Working | Full CRUD + movement tracking |
| Customer tools | ✅ Working | Read + create + interactions |
| Brain Score | ✅ Working | Metrics + recommendations |
| Confirmation flows | ✅ Partial | Works for create operations, missing for updates |
| System prompt | ✅ Working | Comprehensive task instructions included |

---

## 18. Decision Point: V2 Architecture Options

### Option A: Microservices (Ambitious)
- Extract each tool category to separate file
- Each has own handler class
- Pros: Clean separation, easier testing
- Cons: Requires refactoring 5000+ lines, higher risk of bugs

**Recommendation:** ⏭️ Skip for Phase 1

### Option B: Modular Services (Recommended)
- Extract task service first (`lib/brain/tasks/service.ts`)
- ToolHandlers delegates to it
- Deploy alongside existing ToolHandlers
- Test thoroughly before removing V1
- Extract other services incrementally

**Recommendation:** ✅ **CHOOSE THIS FOR PHASE 1**

### Option C: Keep Monolithic (Safest)
- Improve route.ts in place
- Refactor ToolHandlers class structure
- Keep all logic in one file
- Pros: Minimal changes, lowest risk
- Cons: Code continues to grow unwieldy

**Recommendation:** 🛑 Not recommended for V2 ambitions

---

## Appendix: File Inventory

### Core AI Implementation
- `app/api/brain/chat/route.ts` (5100+ lines) — Main AI route, contains all tool handlers

### Supporting Libraries
- `lib/supabaseServer.ts` — Supabase client creation
- `lib/supabaseClient.ts` — Client-side Supabase (not used by Brain)
- `lib/brain/priorityMapper.ts` — Urgency to priority mapping utility
- `lib/brain/entityResolver.ts` — Entity resolution utilities
- `lib/brain/dateResolver.ts` — Date parsing utilities

### UI Implementation
- `app/dashboard/ai-assistant/page.tsx` — Chat UI
- `app/dashboard/tasks/page.tsx` — Tasks dashboard (placeholder)

### Database Schema (via Supabase console)
- `public.tasks` — Task storage
- `public.employees` — Employee master
- `public.profiles` — User profiles + company assignment
- `public.companies` — Organization master
- `public.departments` — Department lookup
- `public.locations` — Location lookup
- `public.shifts` — Shift assignments
- `public.maintenance_tickets` — Maintenance workflow
- `public.inventory_items` — Inventory tracking
- `public.customers` — Customer management

### Documentation
- `PHASE4_BRAIN_CHAT_DEPLOYMENT.md` — Original deployment docs
- `PHASE4_SUMMARY.md` — Architecture summary
- `PRODUCTION_CHECKLIST.md` — Pre-deployment checklist
- `TASK_UPDATE_FIX_SUMMARY.md` — Recent updateTask improvements
- `TASK_UPDATE_TEST_GUIDE.md` — Testing guide for task updates
- `TASK_UPDATE_CODE_CHANGES.md` — Code-by-code change log

---

## Conclusion

**Brain V1 is functional but monolithic.** The task system works well for creation (with confirmation) but update/delete operations lack the rigor of createTask.

**Brain V2 should:**
1. Extract task service to separate module
2. Enhance updateTask to match createTask validation depth
3. Add context-aware task resolution for pronouns
4. Preserve confirmation flows for all write operations
5. Maintain RLS enforcement throughout
6. Deploy V2 alongside V1 for safe rollover

**No architectural blockers exist.** The current codebase is stable, well-tested, and ready for extraction.

**Next step:** User approval on Phase 1 architecture → begin extraction of TaskService.
