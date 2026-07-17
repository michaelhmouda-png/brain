# Business Events Integration Guide

This guide shows how to integrate the Business Events timeline into your existing application flows. Events are created AFTER the main action succeeds, so failures in event logging don't undo your main operations.

---

## Quick Start

### 1. Import the Service
```typescript
import { BusinessEventsService } from '@/lib/businessEventsService';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
```

### 2. Create an Instance
```typescript
const supabase = await createSupabaseServerAuth();
const { data: { user } } = await supabase.auth.getUser();

const { data: profile } = await supabase
  .from('profiles')
  .select('company_id')
  .eq('id', user.id)
  .single();

const eventService = new BusinessEventsService(supabase, profile.company_id);
```

### 3. Log an Event (After Success)
```typescript
// After creating a task successfully:
await eventService.logTaskCreated(
  createdTaskId,
  taskTitle,
  assignedEmployeeId,
  dueDate
);
```

---

## Integration Examples

### Tasks Module

#### When Creating a Task
```typescript
// In app/api/brain/chat/route.ts or task creation endpoint

export async function createTaskAction(taskData: CreateTaskInput) {
  const supabase = await createSupabaseServerAuth();
  const eventService = new BusinessEventsService(supabase, companyId);

  // 1. Create the task
  const { data: newTask, error } = await supabase
    .from('tasks')
    .insert(taskData)
    .select()
    .single();

  if (error) {
    throw new Error('Failed to create task');
  }

  // 2. Log the event (safe to fail silently)
  await eventService.logTaskCreated(
    newTask.id,
    newTask.title,
    newTask.assigned_employee_id,
    newTask.due_date
  );

  return newTask;
}
```

#### When Assigning a Task
```typescript
export async function assignTaskAction(taskId: string, employeeId: string) {
  const supabase = await createSupabaseServerAuth();
  const eventService = new BusinessEventsService(supabase, companyId);

  // 1. Update the task
  const { data: updatedTask, error } = await supabase
    .from('tasks')
    .update({ assigned_employee_id: employeeId })
    .eq('id', taskId)
    .select()
    .single();

  if (error) {
    throw new Error('Failed to assign task');
  }

  // 2. Get employee name for better event
  const { data: employee } = await supabase
    .from('employees')
    .select('first_name, last_name')
    .eq('id', employeeId)
    .single();

  // 3. Log the event
  const employeeName = employee ? `${employee.first_name} ${employee.last_name}` : undefined;
  await eventService.logTaskAssigned(taskId, updatedTask.title, employeeId, employeeName);

  return updatedTask;
}
```

#### When Completing a Task
```typescript
export async function completeTaskAction(taskId: string) {
  const supabase = await createSupabaseServerAuth();
  const eventService = new BusinessEventsService(supabase, companyId);

  // 1. Update task status
  const { data: completedTask, error } = await supabase
    .from('tasks')
    .update({ status: 'Completed' })
    .eq('id', taskId)
    .select()
    .single();

  if (error) {
    throw new Error('Failed to complete task');
  }

  // 2. Get employee who completed it
  const { data: employee } = await supabase
    .from('employees')
    .select('first_name, last_name')
    .eq('id', completedTask.assigned_employee_id)
    .single();

  // 3. Log the event
  const employeeName = employee ? `${employee.first_name} ${employee.last_name}` : undefined;
  await eventService.logTaskCompleted(taskId, completedTask.title, completedTask.assigned_employee_id, employeeName);

  return completedTask;
}
```

### Inventory Module

#### When Recording a Movement
```typescript
export async function recordInventoryMovement(
  inventoryItemId: string,
  quantity: number,
  movementType: 'in' | 'out' | 'adjustment' | 'waste',
  reason?: string
) {
  const supabase = await createSupabaseServerAuth();
  const eventService = new BusinessEventsService(supabase, companyId);

  // 1. Create the movement record
  const { data: movement, error } = await supabase
    .from('inventory_movements')
    .insert({
      inventory_item_id: inventoryItemId,
      movement_type: movementType,
      quantity,
      reason,
      company_id: companyId,
    })
    .select()
    .single();

  if (error) {
    throw new Error('Failed to record movement');
  }

  // 2. Get item name
  const { data: item } = await supabase
    .from('inventory_items')
    .select('name, current_quantity, minimum_quantity')
    .eq('id', inventoryItemId)
    .single();

  // 3. Log the movement event
  if (item) {
    await eventService.logInventoryMovement(
      inventoryItemId,
      item.name,
      movementType,
      quantity,
      reason
    );

    // 4. Check if now below minimum and log if so
    if (item.current_quantity - quantity < item.minimum_quantity) {
      await eventService.logLowStockDetected(
        inventoryItemId,
        item.name,
        item.current_quantity - quantity,
        item.minimum_quantity
      );
    }
  }

  return movement;
}
```

### Customers Module

#### When Recording a Complaint
```typescript
export async function recordCustomerComplaint(
  customerId: string,
  description: string
) {
  const supabase = await createSupabaseServerAuth();
  const eventService = new BusinessEventsService(supabase, companyId);

  // 1. Create interaction record
  const { data: interaction, error } = await supabase
    .from('customer_interactions')
    .insert({
      customer_id: customerId,
      interaction_type: 'complaint',
      description,
      company_id: companyId,
    })
    .select()
    .single();

  if (error) {
    throw new Error('Failed to record complaint');
  }

  // 2. Get customer name
  const { data: customer } = await supabase
    .from('customers')
    .select('first_name, last_name')
    .eq('id', customerId)
    .single();

  // 3. Log the complaint event
  const customerName = customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown';
  await eventService.logCustomerComplaint(customerId, customerName, description);

  return interaction;
}
```

#### When Recording an Interaction
```typescript
export async function recordCustomerInteraction(
  customerId: string,
  interactionType: string,
  description: string
) {
  const supabase = await createSupabaseServerAuth();
  const eventService = new BusinessEventsService(supabase, companyId);

  // 1. Create interaction
  const { data: interaction, error } = await supabase
    .from('customer_interactions')
    .insert({
      customer_id: customerId,
      interaction_type: interactionType,
      description,
      company_id: companyId,
    })
    .select()
    .single();

  if (error) {
    throw new Error('Failed to record interaction');
  }

  // 2. Get customer name
  const { data: customer } = await supabase
    .from('customers')
    .select('first_name, last_name')
    .eq('id', customerId)
    .single();

  // 3. Log the event
  const customerName = customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown';
  await eventService.logCustomerInteraction(customerId, customerName, interactionType, description);

  return interaction;
}
```

### Employees Module

#### When Creating an Employee
```typescript
export async function createEmployeeAction(employeeData: EmployeeCreate) {
  const supabase = await createSupabaseServerAuth();
  const eventService = new BusinessEventsService(supabase, companyId);

  // 1. Create employee
  const { data: newEmployee, error } = await supabase
    .from('employees')
    .insert(employeeData)
    .select()
    .single();

  if (error) {
    throw new Error('Failed to create employee');
  }

  // 2. Log the event
  const employeeName = `${newEmployee.first_name} ${newEmployee.last_name}`;
  await eventService.logEmployeeCreated(newEmployee.id, employeeName);

  return newEmployee;
}
```

#### When Updating an Employee
```typescript
export async function updateEmployeeAction(
  employeeId: string,
  updates: Partial<Employee>
) {
  const supabase = await createSupabaseServerAuth();
  const eventService = new BusinessEventsService(supabase, companyId);

  // 1. Update employee
  const { data: updatedEmployee, error } = await supabase
    .from('employees')
    .update(updates)
    .eq('id', employeeId)
    .select()
    .single();

  if (error) {
    throw new Error('Failed to update employee');
  }

  // 2. Log what was updated
  const updatedFields = Object.keys(updates);
  const employeeName = `${updatedEmployee.first_name} ${updatedEmployee.last_name}`;
  await eventService.logEmployeeUpdated(employeeId, employeeName, updatedFields);

  return updatedEmployee;
}
```

### Brain Score Module

#### When Score Changes
```typescript
export async function updateBrainScore(newScore: BrainScore) {
  const supabase = await createSupabaseServerAuth();
  const eventService = new BusinessEventsService(supabase, companyId);

  // 1. Get previous score
  const { data: previousSnapshots } = await supabase
    .from('brain_score_snapshots')
    .select('total_score')
    .eq('company_id', companyId)
    .order('calculated_at', { ascending: false })
    .limit(1);

  const previousScore = previousSnapshots?.[0]?.total_score;

  // 2. Create new snapshot
  const { data: snapshot, error } = await supabase
    .from('brain_score_snapshots')
    .insert({
      company_id: companyId,
      total_score: newScore.total,
      operations_score: newScore.categories.operations,
      employees_score: newScore.categories.employees,
      inventory_score: newScore.categories.inventory,
      customers_score: newScore.categories.customers,
      data_quality_score: newScore.categories.data_quality,
      metrics: newScore.metrics,
    })
    .select()
    .single();

  if (error) {
    throw new Error('Failed to save brain score');
  }

  // 3. Log the change if score actually changed
  if (previousScore && previousScore !== newScore.total) {
    await eventService.logBrainScoreChanged(
      previousScore,
      newScore.total,
      newScore.categories
    );
  }

  return snapshot;
}
```

---

## Best Practices

### 1. Always Create First, Then Log
```typescript
// ✅ CORRECT: Create first, event second
await supabase.from('tasks').insert(taskData);
await eventService.logTaskCreated(...);

// ❌ WRONG: Event first could orphan event if creation fails
await eventService.logTaskCreated(...);
await supabase.from('tasks').insert(taskData); // If this fails, event exists but no task
```

### 2. Don't Let Event Failures Stop the Main Action
```typescript
// ✅ CORRECT: Event failure doesn't throw
try {
  // Main action
  const task = await createTask();
  
  // Event creation (failures logged silently)
  await eventService.logTaskCreated(task.id, task.title);
  
  return task;
} catch (err) {
  // Only main action errors are caught
  throw err;
}

// ❌ WRONG: If event fails, main action appears to fail
try {
  const task = await createTask();
  await eventService.logTaskCreated(task.id, task.title); // If throws, whole operation fails
  return task;
} catch (err) {
  throw err; // User thinks create failed when only event logging failed
}
```

### 3. Use Deterministic Wording
```typescript
// ✅ CORRECT: Specific, factual
await eventService.logTaskCompleted(taskId, 'Restock the bar', employeeId, 'Maroun');
// Creates: "Maroun completed Restock the bar"

// ❌ WRONG: Vague or AI-generated
await eventService.logTaskCompleted(taskId, 'Important task', employeeId, 'Employee');
// Creates: "Employee completed Important task"
```

### 4. Include Useful Metadata
```typescript
// ✅ CORRECT: Full context in metadata
await eventService.logInventoryMovement(
  itemId,
  'Grey Goose',
  'out',
  5,
  'Happy hour special'
);

// ❌ WRONG: Missing context
await eventService.logInventoryMovement(itemId, 'Item', 'out', 5);
```

### 5. Handle Name Resolution
```typescript
// ✅ CORRECT: Get human names
const { data: employee } = await supabase
  .from('employees')
  .select('first_name, last_name')
  .eq('id', employeeId)
  .single();

const name = `${employee?.first_name} ${employee?.last_name}` || 'Unknown';
await eventService.logTaskCompleted(taskId, title, employeeId, name);

// ❌ WRONG: Use UUID as name
await eventService.logTaskCompleted(taskId, title, employeeId, '123e4567-e89b-12d3-a456-426614174000');
```

---

## Query Methods

### Get Latest Events
```typescript
const events = await eventService.getRecentEvents(10); // Latest 10
const events = await eventService.getRecentEvents(20); // Latest 20
```

### Get Events by Module
```typescript
const taskEvents = await eventService.getEventsByModule('Tasks', 20);
const inventoryEvents = await eventService.getEventsByModule('Inventory', 20);
```

### Get Events by Type
```typescript
const completedTasks = await eventService.getEventsByType('task_completed', 20);
const lowStock = await eventService.getEventsByType('low_stock_detected', 20);
```

### Get Critical Events Only
```typescript
const alerts = await eventService.getCriticalEvents(10); // Latest 10 critical/high events
```

---

## Timeline Component Usage

The timeline is already integrated into the Premium Command Center component at `/dashboard`.

To use it elsewhere:
```typescript
import { PremiumCommandCenter } from '@/components/PremiumCommandCenter';

export default function MyPage() {
  return <PremiumCommandCenter />;
}
```

Or access the timeline API directly:
```typescript
const response = await fetch('/api/brain/timeline');
const { events } = await response.json();
```

---

## Troubleshooting

### Event Not Appearing in Timeline
**Possible causes:**
1. Service was not awaited: `await eventService.logTaskCreated()`
2. Event failed silently (check browser console)
3. Event is for different company than current user
4. Event is older than 10 (Timeline shows latest 10 only)

**Debug:**
```typescript
// Check if event was created
const { data: events } = await supabase
  .from('business_events')
  .select('*')
  .eq('company_id', myCompanyId)
  .order('occurred_at', { ascending: false })
  .limit(1);

console.log('Latest event:', events[0]);
```

### Service Not Initialized
```typescript
// Make sure to create service instance before use
const eventService = new BusinessEventsService(supabase, companyId);

// Then use it
await eventService.logTaskCreated(...);
```

### Company Isolation Issues
All queries automatically filter by `company_id` from authenticated user's profile. No additional filtering needed.

---

## Next Steps

1. **Implement in one module first** (e.g., Tasks)
2. **Test the timeline** - verify events appear
3. **Roll out to other modules** one by one
4. **Monitor performance** - should be negligible with indexes

---

## Support

For questions or issues:
1. Check console for silent event failures
2. Verify database table exists: `SELECT * FROM business_events LIMIT 1;`
3. Ensure company_id matches authenticated user
4. Review RLS policies in Supabase Dashboard

Happy logging! 🎉
