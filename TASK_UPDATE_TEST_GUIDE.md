# Task Update Fix - Quick Test Guide

## How to Test

### Test Setup
1. Ensure the application is built and running
2. Have access to browser console (F12) to see network requests
3. Have access to server logs to see console output

### Test Case 1: Basic Pronoun Resolution ✅

**Command Sequence:**
```
1. User: "What tasks do I have?"
2. Assistant: [displays list of tasks]
3. User: "Make it critical"
4. Assistant: [should update the first task to Critical priority]
```

**Expected Behavior:**
- Step 1: getTasks returns list
- Step 2: Context stores first task ID in lastMentionedTaskId
- Step 3: update_task called without explicit task_id
- Step 4: updateTask resolves task ID from context and updates

**Verification in Logs:**
```
[Brain Chat] Tool called: { toolName: 'get_tasks', ... }
[Task Query] Results retrieved: { count: N, taskTitles: [...] }
[Brain Chat] Context updated - lastMentionedTask: { id: '<uuid>', title: '...' }

[Brain Chat] Tool called: { toolName: 'update_task', ... }
[Task Update] Request received: { providedTaskId: undefined, priority: 'Critical', ... }
[Task Update] Using lastMentionedTaskId from context: <uuid>
[Task Update] Success - Task updated: { ..., priority: 'Critical', ... }
```

### Test Case 2: Value Normalization ✅

**Command:**
```
User: "Change the priority to high and mark it in progress"
```

**Expected Behavior:**
- Input values: "high" (lowercase), "in progress" (spaces)
- Normalized: "High", "In Progress" (match database exactly)
- Database update succeeds (no CHECK constraint violation)

**Verification in Logs:**
```
[Task Update] Priority normalized: high -> High
[Task Update] Status normalized: in progress -> In Progress
[Task Update] Update payload: { priority: 'High', status: 'In Progress' }
[Task Update] Success - Task updated: { priority: 'High', status: 'In Progress' }
```

### Test Case 3: Error Handling ✅

**Command Sequence:**
```
1. User: "Make it critical"  (no prior task mentioned)
2. Assistant: [error message]
```

**Expected Behavior:**
- No lastMentionedTaskId in context
- Clear error message: "Task could not be identified..."
- User prompted to list tasks first or specify details

**Verification in Logs:**
```
[Task Update] Request received: { providedTaskId: undefined, ... }
[Task Update] No task ID provided, attempting fuzzy search...
[response] error: 'Task could not be identified. Please specify which task...'
```

### Test Case 4: Explicit Task ID Still Works ✅

**Command:**
```
User: "Update task 550e8400-e29b-41d4-a716-446655440000 to high priority"
```

**Expected Behavior:**
- Explicit task_id provided in tool arguments
- No context lookup needed
- Direct database update

**Verification in Logs:**
```
[Brain Chat] Tool called: { toolName: 'update_task', arguments: { task_id: '550e8400...', priority: 'high' } }
[Task Update] Request received: { providedTaskId: '550e8400...', priority: 'high' }
[Task Update] Priority normalized: high -> High
[Task Update] Update payload: { priority: 'High' }
[Task Update] Success - Task updated: { ..., priority: 'High' }
```

### Test Case 5: Task Creation and Update ✅

**Command Sequence:**
```
1. User: "Create a task to buy supplies with high priority"
2. Assistant: [confirms task creation]
3. User: "Make it critical instead"
4. Assistant: [updates to critical]
```

**Expected Behavior:**
- Step 2: createTask stores new task in lastMentionedTaskId
- Step 3: update_task resolves to the created task
- Step 4: Priority changes from High to Critical

**Verification in Logs:**
```
[Brain Chat] Context updated - lastMentionedTask (created): { id: '<new-uuid>', title: 'buy supplies' }

[Brain Chat] Tool called: { toolName: 'update_task', arguments: { priority: 'Critical' } }
[Task Update] Using lastMentionedTaskId from context: <new-uuid>
[Task Update] Success - Task updated: { ..., priority: 'Critical' }
```

## Debug Commands

### View Console Logs
**In browser terminal:**
```javascript
// Filter for task-related logs
console.log = (function() {
  const orig = console.log;
  return function(...args) {
    if (args[0] && typeof args[0] === 'string' && 
        (args[0].includes('[Task') || args[0].includes('[Brain'))){
      orig(...args);
    }
  }
})();
```

### Check Context in Browser
**After running a command:**
```javascript
// Last response context is in the conversation context
console.table(lastContext); // if exposed by frontend
```

### View Server Logs
**Terminal where app is running:**
```bash
# All task-related logs
grep -i "task" <server_logs>

# Task update specifically
grep "Task Update" <server_logs>

# Tool calls
grep "Tool called" <server_logs>

# Context updates
grep "Context updated" <server_logs>
```

## Monitoring

### Real-time Server Logs
```bash
cd c:\Users\USER\brain
npm run dev
```
Then watch the terminal for `[Task Update]` and `[Brain Chat]` prefixed logs.

### Database Verification
After a task update, verify in Supabase console:
```sql
SELECT id, title, priority, status, updated_at 
FROM tasks 
WHERE id = '<task-id>' 
AND company_id = '<company-id>';
```

## Common Issues and Fixes

### Issue: "Task could not be identified" when it should work
**Cause:** lastMentionedTaskId not set in context
**Fix:** Check that getTasks was called before update_task. Verify context is being passed in request body.
**Log to check:** `[Brain Chat] Context updated - lastMentionedTask` should appear after getTasks

### Issue: Priority not updating to correct case
**Cause:** Value normalization not applied
**Fix:** Check that normalization code is running. Verify database CHECK constraints allow the value.
**Log to check:** `[Task Update] Priority normalized:` should show conversion

### Issue: "Task ... was not found" error
**Cause:** Task ID doesn't exist or user lacks permission
**Fix:** 
  1. Verify task actually exists: `SELECT id FROM tasks WHERE id = '<id>'`
  2. Check RLS policies grant UPDATE permission
  3. Verify company_id matches
**Log to check:** `[Task Update] Supabase error:` with code and details

### Issue: Can't see logs
**Cause:** Logs might be at debug level or not configured
**Fix:** 
  1. Ensure no log filters are active
  2. Check that console.log is not overridden
  3. Run in development mode: `npm run dev`
**Log to check:** Should start appearing within seconds of running any task command

## Rollback Plan

If issues arise, the changes are isolated to:
- `app/api/brain/chat/route.ts` - All changes are additive (new logging, context fields)
- ConversationContext interface - New fields are optional
- updateTask function - Backward compatible

To rollback:
1. Restore previous version of `route.ts`
2. Remove new ConversationContext fields (optional)
3. No database changes needed (schema untouched)

## Success Criteria ✅

After deployment, verify:
- [x] Build passes: `npm run build` → 0 errors
- [x] App starts: `npm run dev` → no crashes
- [x] Task listing works: "Show me tasks" → list displayed
- [x] Pronoun resolution works: "Make it critical" → updates using context
- [x] Value normalization works: "high" → "High" in database
- [x] Errors visible: Missing task ID → clear message not generic error
- [x] Logging works: Console shows `[Task Update]` logs
- [x] Context preserved: Conversation continues using stored task ID
- [x] Backward compatible: Explicit task IDs still work
- [x] Database OK: Task fields update correctly (select from DB confirms)
