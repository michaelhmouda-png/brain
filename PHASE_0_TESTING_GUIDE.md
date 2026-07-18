# Phase 0: Root Cause Diagnostic - Testing Sequence

**Status**: Phase 0B-0C Complete. Ready for Phase 0F Testing.

**Objective**: Verify that the task update failure was caused by enum value mismatches (capitalized vs lowercase), now fixed. Confirm all components work end-to-end: getTasks → updateTask → context handling → AI command.

---

## Phase 0B & 0C Summary (Completed)

### Phase 0B: Comprehensive Diagnostic Logging (✅ DONE)

Enhanced `app/api/brain/chat/route.ts` with structured logs throughout the task flow:

1. **Request Entry** (lines 4275-4300):
   - Logs incoming message, conversationContext, pendingAction
   - Shows what the user wants to do

2. **ToolHandlers Initialization** (lines 4351-4360):
   - Logs context state before tool execution
   - Shows company_id, user context

3. **Task Handlers** (getTasks, updateTask, completeTask):
   - `getTasks` input/output logs (lines 2413, 2491-2505)
   - `updateTask` resolution logs (lines 2520-2549)
   - `updateTask` normalization logs (lines 2561-2569)
   - `updateTask` Supabase query details (lines 2571-2573)
   - `updateTask` success/error logs (lines 2595-2612, 2680-2695)

4. **Context Update Logs** (lines 5205-5220, 5248-5255):
   - After getTasks: stores first task in lastMentionedTaskId
   - After updateTask: updates context with new values

5. **Final Response** (lines 5290-5300):
   - Shows final message and context state

### Phase 0C: Debug Endpoint (✅ DONE)

Created **POST /api/brain/debug/tasks** for direct testing:

- **Development-only** (forbidden in production)
- **Requires authentication** (same Supabase client, RLS enforced)
- **Two actions**:
  - `find`: Search by title/employee/due_date → returns exact task or error
  - `update`: Update specific taskId with canonical values → verifies Supabase succeeds

---

## Phase 0F: Testing Sequence

### Prerequisites

1. **Start Dev Server**:
   ```bash
   npm run dev
   # Server should be running at http://localhost:3000
   ```

2. **Prepare Test Data** (if not already created):
   - Task: "Restock the bar"
   - Assigned to: Maroun Mhanna
   - Due: 2026-07-18
   - Priority: Low (to test change to Critical)

3. **Open Browser Console**:
   - Chrome/Edge: F12 → Console tab
   - Monitor logs in real-time

4. **Open Terminal**:
   - Watch server logs: `npm run dev`
   - Look for `[Brain Diagnostic]` and `[Task Update]` logs

---

## Test 1: Direct Find (Debug Endpoint)

**Objective**: Verify task can be found with debug endpoint

**Steps**:

1. Send HTTP POST request:
   ```bash
   curl -X POST http://localhost:3000/api/brain/debug/tasks \
     -H "Content-Type: application/json" \
     -d '{
       "action": "find",
       "title": "Restock the bar",
       "assignedEmployeeName": "Maroun Mhanna",
       "dueDate": "2026-07-18"
     }'
   ```

2. **Expected Response**:
   ```json
   {
     "success": true,
     "task": {
       "id": "uuid-here",
       "title": "Restock the bar",
       "priority": "Low",
       "priority_db": "low",
       "status": "Pending",
       "status_db": "pending",
       "due_date": "2026-07-18",
       "assigned_to": "Maroun Mhanna",
       "assigned_employee_id": "uuid"
     }
   }
   ```

3. **Server Logs to Check**:
   ```
   [Brain Debug] Request received: { action: 'find', title: 'Restock the bar', ... }
   [Brain Debug] find action: { title: 'Restock the bar', ... }
   [Brain Debug] Query results: { foundCount: 1, filtered: 1 }
   ```

4. **Record Task UUID**: Save `task.id` from response for Test 2

**✅ Success Criteria**: Response contains task with priority_db: "low" (lowercase)

---

## Test 2: Direct Update (Debug Endpoint)

**Objective**: Verify task can be updated directly with canonical values

**Prerequisites**: Have task UUID from Test 1

**Steps**:

1. Send HTTP POST request:
   ```bash
   curl -X POST http://localhost:3000/api/brain/debug/tasks \
     -H "Content-Type: application/json" \
     -d '{
       "action": "update",
       "taskId": "INSERT_UUID_FROM_TEST_1_HERE",
       "updates": {
         "priority": "Critical"
       }
     }'
   ```

2. **Expected Response**:
   ```json
   {
     "success": true,
     "task": {
       "id": "uuid-here",
       "title": "Restock the bar",
       "priority": "Critical",
       "priority_db": "critical",
       "status": "Pending",
       "status_db": "pending",
       "due_date": "2026-07-18"
     }
   }
   ```

3. **Server Logs to Check**:
   ```
   [Brain Debug] update action: { taskId: 'uuid', updates: { priority: 'Critical' } }
   [Brain Debug] Priority normalized: Critical -> critical
   [Brain Debug] Update payload (canonical values): { priority: 'critical' }
   [Brain Debug] Supabase update result | SUCCESS
   ```

4. **Database Verification**:
   - Open Supabase console or pgAdmin
   - Query: `SELECT priority, status FROM tasks WHERE id = 'UUID_HERE'`
   - Should show: priority='critical' (lowercase), status='pending'

**✅ Success Criteria**: 
- Response shows priority_db: "critical" (lowercase)
- Database row has priority='critical' (not 'Critical')
- No Supabase errors

---

## Test 3: AI Command (Full End-to-End)

**Objective**: Verify AI correctly calls getTasks → updateTask with proper context

**Steps**:

1. Open chat at http://localhost:3000/dashboard/ai-assistant

2. Send message:
   ```
   Change the priority of the task 'Restock the bar' assigned to Maroun Mhanna and due on July 18, 2026 to Critical
   ```

3. **Expected Output**:
   - Chat response: "Task 'Restock the bar' was updated successfully. Priority changed to Critical."
   - Or similar success message

4. **Server Logs to Check** (watch for this sequence):
   ```
   [Brain Diagnostic] request entry | message=<user message>
   [Brain Diagnostic] ToolHandlers init | companyId=<uuid>
   [Brain Diagnostic] OpenAI call | toolCount=50
   
   // AI decides to call getTasks
   [Brain Diagnostic] getTasks input: { title: 'Restock the bar', ... }
   [Brain Diagnostic] getTasks result: { count: 1, tasks: [...] }
   
   // Context is updated
   [Brain Diagnostic] context update | after getTasks
   
   // AI decides to call updateTask with the found task
   [Brain Diagnostic] updateTask input: { task_id: 'uuid', priority: 'Critical' }
   [Task Update] task resolution | stage=RESOLVED
   [Brain Diagnostic] normalized update payload | priority='critical', status=undefined
   [Brain Diagnostic] Supabase update query | taskId='uuid'
   [Brain Diagnostic] Supabase update result | SUCCESS
   
   // Context is updated again
   [Brain Diagnostic] context update | after updateTask
   
   // Final response
   [Brain Diagnostic] final response | message=<assistant message>
   ```

5. **Database Verification**:
   - Query same task: `SELECT priority, status FROM tasks WHERE id = 'UUID_HERE'`
   - Should now show: priority='critical', status='pending'

**✅ Success Criteria**:
- AI correctly calls getTasks
- AI correctly calls updateTask with proper task_id
- Priority updated to 'critical' (lowercase) in database
- No enum mismatch errors
- Context shows lastMentionedTaskId correctly

---

## Test 4: Pronoun Resolution (Context-Based Update)

**Objective**: Verify context is properly used for pronoun resolution

**Prerequisites**: Test 3 completed

**Steps**:

1. Continue in same chat (or send another message to same assistant)

2. Send message:
   ```
   Make it High instead
   ```

3. **Expected Output**:
   - Chat response: "Task 'Restock the bar' priority changed to High."
   - Or similar success message

4. **Server Logs to Check**:
   ```
   [Brain Diagnostic] request entry | message=Make it High instead
   [Brain Diagnostic] request context | lastMentionedTaskId=<uuid>
   
   // updateTask is called directly without getTasks
   [Brain Diagnostic] updateTask input: { priority: 'High' }
   [Task Update] Using lastMentionedTaskId from context: <uuid>
   [Brain Diagnostic] task resolution | source=context
   
   // Priority is normalized and updated
   [Brain Diagnostic] normalized update payload | priority='high'
   [Brain Diagnostic] Supabase update query | taskId=<uuid>
   [Brain Diagnostic] Supabase update result | SUCCESS
   ```

5. **Database Verification**:
   - Query same task: `SELECT priority FROM tasks WHERE id = 'UUID_HERE'`
   - Should show: priority='high' (lowercase)

**✅ Success Criteria**:
- updateTask uses lastMentionedTaskId from context (no explicit ID needed)
- Priority normalized from "High" to "high"
- Database updated correctly
- No fetch or context resolution errors

---

## Test 5: Completion Status (Edge Case)

**Objective**: Verify completeTask uses correct lowercase 'completed' status

**Steps**:

1. Send message:
   ```
   Mark the 'Restock the bar' task completed
   ```

2. **Expected Output**:
   - Chat response: "Task 'Restock the bar' marked as Completed."

3. **Server Logs to Check**:
   ```
   [Brain Diagnostic] updateTask input: { task_id: 'uuid', status: 'completed' }
   [Brain Diagnostic] normalized update payload | status='completed'
   [Brain Diagnostic] Supabase update result | SUCCESS
   ```

   OR if using completeTask directly:
   ```
   [Brain Diagnostic] completeTask called for task 'uuid'
   [Brain Chat] Task completed: Restock the bar
   [Brain Diagnostic] Supabase update result | SUCCESS
   ```

4. **Database Verification**:
   - Query same task: `SELECT status FROM tasks WHERE id = 'UUID_HERE'`
   - Should show: status='completed' (lowercase, NOT 'Completed')

**✅ Success Criteria**:
- Status is 'completed' (lowercase), not 'Completed'
- No CHECK constraint violations
- Task updated successfully in database

---

## Test 6: Full Database Verification

**Objective**: Verify all changes persisted correctly in database

**Steps**:

1. Connect to Supabase database (via console or pgAdmin)

2. Run query:
   ```sql
   SELECT 
     id,
     title,
     priority,
     status,
     due_date,
     assigned_employee_id,
     updated_at
   FROM tasks
   WHERE title = 'Restock the bar'
   AND company_id = '<YOUR_COMPANY_ID>';
   ```

3. **Expected Row Values**:
   ```
   id:                  <uuid>
   title:               'Restock the bar'
   priority:            'high'  (or 'critical', lowercase only)
   status:              'completed'  (or 'pending', lowercase only)
   due_date:            2026-07-18
   assigned_employee_id: <uuid for Maroun Mhanna>
   updated_at:          <recent timestamp>
   ```

4. **CRITICAL CHECK**: Verify enum values are **lowercase**:
   - ❌ WRONG: 'High', 'Critical', 'Completed', 'In Progress'
   - ✅ CORRECT: 'high', 'critical', 'completed', 'pending', 'in_progress'

**✅ Success Criteria**:
- All enum values are lowercase
- All changes from tests 1-5 are persisted
- No mixed-case values
- RLS correctly enforced (only company tasks visible)

---

## Diagnostic Log Format Reference

All `[Brain Diagnostic]` logs follow this pattern:

```
[Brain Diagnostic] <stage> | <key1>=<value1>, <key2>=<value2>, ...
```

**Common Stages**:
- `request entry` - User message received
- `getTasks input` - Task search parameters
- `getTasks result` - Results from database
- `task resolution | stage=RESOLVED` - Task ID found
- `task resolution | stage=FAILED` - Task not found
- `normalized update payload` - Canonical enum values
- `Supabase update result | SUCCESS` - Update succeeded
- `Supabase update result | FAILED` - Supabase error
- `context update | after getTasks` - Context updated from search
- `context update | after updateTask` - Context updated from update
- `final response` - Response being sent to client

---

## Troubleshooting Guide

### Issue: "I can't reach the task system"

**Debug Steps**:
1. Check server logs for `[Brain Diagnostic]` entry point
2. Look for `Supabase update result | FAILED`
3. Check error code and details from Supabase
4. Common causes:
   - Enum mismatch (should be fixed by Phase 0)
   - RLS policy violation (check company_id)
   - Invalid UUID format
   - NULL required field

### Issue: Priority shows "High" but database has "high"

**Expected Behavior**: 
- Display value: "High" (capitalized in UI)
- Database value: "high" (lowercase in storage)
- This is correct! Use displayTaskPriority() for UI.

### Issue: Task not found by search

**Debug Steps**:
1. Verify task exists in database
2. Check exact title match (case-sensitive by default)
3. Use debug endpoint `/api/brain/debug/tasks` to search
4. Verify assigned_employee_id matches

### Issue: Enum violation error from Supabase

**Cause**: Normalization not using canonical values
- Check Phase 0C: updateTask normalization (lines 2560-2569)
- Verify using canonicalPriority()/canonicalStatus()
- Look for places setting enum values manually (should not exist)

---

## Success Criteria Summary

✅ **All Tests Pass If**:
1. Test 1: Debug endpoint finds task correctly
2. Test 2: Debug endpoint updates with canonical values
3. Test 3: AI command performs getTasks → updateTask correctly
4. Test 4: Context resolution works for pronoun handling
5. Test 5: Completion status uses lowercase 'completed'
6. Test 6: Database shows only lowercase enum values

✅ **Root Cause Verified If**:
- All enum values in database are lowercase
- updateTask and completeTask use canonicalPriority/canonicalStatus
- Logs show proper normalization
- No CHECK constraint violations
- No "Can't reach task system" errors

❌ **Root Cause NOT Fixed If**:
- Still seeing "Can't reach task system" error
- Database has mixed-case enum values ('High', 'Completed')
- Supabase returns constraint violation errors
- updateTask bypasses normalization

---

## Next Steps After Phase 0F

**If All Tests Pass**:
1. Wait for user approval
2. Document findings in Phase 0G report
3. Create migration plan if broader changes needed
4. Close Phase 0 diagnostic

**If Any Test Fails**:
1. Review relevant logs
2. Check Phase 0B diagnostics
3. Identify specific failure point
4. Escalate with detailed error logs
5. May need additional diagnostic phases

---

## Reference: Files Modified in Phase 0

| File | Change | Purpose |
|------|--------|---------|
| `app/api/brain/chat/route.ts` | Enhanced diagnostic logging | Phase 0B logging |
| `lib/brain/taskConstants.ts` | Created new file | Canonical enum values |
| `app/api/brain/debug/tasks/route.ts` | Created new endpoint | Phase 0C debug endpoint |

## Reference: Key Bug Fixes

1. **updateTask**: Now uses `canonicalPriority()`/`canonicalStatus()` instead of capitalization
2. **completeTask**: Now uses `TASK_STATUS.COMPLETED` instead of hardcoded `'Completed'`
3. **Database**: All enum values stored lowercase, matching CHECK constraints
