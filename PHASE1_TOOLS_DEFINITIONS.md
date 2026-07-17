# Phase 1 HospiBrain AI Tool Definitions

**Target:** Paste tool definitions into `/app/api/brain/chat/route.ts` TOOLS array and interfaces into the types section.

---

## TypeScript Interface Definitions

```typescript
// ─── SHIFT MANAGEMENT INTERFACES ────────────────────────────────────────────
interface GetShiftsInput {
  status?: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  employee_name?: string;           // partial match
  location_id?: string;
  date?: string;                    // YYYY-MM-DD or "today", "tomorrow", "next week"
  limit?: number;                   // max results (default 20, max 100)
}

interface CreateShiftInput {
  start_time: string;               // HH:MM format or "9am", "2pm", etc.
  end_time: string;                 // HH:MM format or "5pm", "10pm", etc.
  shift_date: string;               // YYYY-MM-DD or "today", "tomorrow", day name
  employee_name?: string;           // auto-resolved to employee_id
  employee_id?: string;             // UUID reference
  location_id?: string;             // UUID reference
  shift_type?: 'opening' | 'closing' | 'mid' | 'full';  // shift classification
  notes?: string;
  confirmed?: boolean;              // false = preview, true = insert
}

interface UpdateShiftInput {
  shift_id: string;                 // required UUID
  start_time?: string;
  end_time?: string;
  shift_date?: string;
  employee_name?: string;
  employee_id?: string;
  shift_type?: 'opening' | 'closing' | 'mid' | 'full';
  status?: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  notes?: string;
}

interface DeleteShiftInput {
  shift_id: string;                 // required UUID
}

interface GetSchedulesInput {
  location_id?: string;
  date_from?: string;               // YYYY-MM-DD (default: today)
  date_to?: string;                 // YYYY-MM-DD (default: 7 days from today)
  employee_id?: string;
  include_conflicts?: boolean;      // flag overlapping shifts
}

interface CreateScheduleInput {
  name: string;                     // schedule name, e.g., "Summer Season"
  start_date: string;               // YYYY-MM-DD
  end_date: string;                 // YYYY-MM-DD
  location_id: string;              // UUID reference
  description?: string;
  template_shifts?: Array<{
    day_of_week: number;            // 0-6 (Sunday-Saturday)
    start_time: string;             // HH:MM format
    end_time: string;
    shift_type: string;
  }>;
  confirmed?: boolean;
}

// ─── MAINTENANCE INTERFACES ─────────────────────────────────────────────────
interface GetMaintenanceTicketsInput {
  status?: 'open' | 'in_progress' | 'completed' | 'cancelled';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  location_id?: string;
  assigned_to?: string;             // employee name, partial match
  created_after?: string;           // YYYY-MM-DD
  limit?: number;                   // max results (default 20, max 100)
}

interface CreateMaintenanceTicketInput {
  title: string;                    // required
  description: string;              // detailed description of issue
  location_id: string;              // required UUID reference
  asset_type?: string;              // e.g., "HVAC", "Refrigerator", "POS System", "Plumbing"
  priority?: 'low' | 'medium' | 'high' | 'critical';
  assigned_to_name?: string;        // employee name for auto-resolution
  assigned_to_id?: string;          // UUID reference
  estimated_duration?: number;      // minutes
  notes?: string;
  confirmed?: boolean;
}

interface UpdateMaintenanceTicketInput {
  ticket_id: string;                // required UUID
  title?: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  status?: 'open' | 'in_progress' | 'completed' | 'cancelled';
  assigned_to_name?: string;
  assigned_to_id?: string;
  resolution_notes?: string;        // notes when completing
  actual_duration?: number;         // minutes spent
}

interface DeleteMaintenanceTicketInput {
  ticket_id: string;                // required UUID
}

// ─── ANNOUNCEMENTS INTERFACES ───────────────────────────────────────────────
interface GetAnnouncementsInput {
  status?: 'draft' | 'published' | 'archived';
  audience?: 'all_staff' | 'managers' | 'location_specific' | 'department_specific';
  location_id?: string;
  created_after?: string;           // YYYY-MM-DD
  limit?: number;                   // max results (default 20, max 100)
}

interface CreateAnnouncementInput {
  title: string;                    // required
  content: string;                  // required — HTML or plain text
  audience: 'all_staff' | 'managers' | 'location_specific' | 'department_specific';
  location_ids?: string[];          // required if audience='location_specific'
  department_ids?: string[];        // required if audience='department_specific'
  priority?: 'normal' | 'high' | 'urgent';
  expires_at?: string;              // YYYY-MM-DD (optional expiration date)
  confirmed?: boolean;
}

interface UpdateAnnouncementInput {
  announcement_id: string;          // required UUID
  title?: string;
  content?: string;
  status?: 'draft' | 'published' | 'archived';
  audience?: 'all_staff' | 'managers' | 'location_specific' | 'department_specific';
  location_ids?: string[];
  department_ids?: string[];
  priority?: 'normal' | 'high' | 'urgent';
  expires_at?: string;
}

interface DeleteAnnouncementInput {
  announcement_id: string;          // required UUID
}

interface RecordAcknowledgmentInput {
  announcement_id: string;          // required UUID
  employee_id?: string;             // auto-populated from auth user
  acknowledged_at?: string;         // defaults to now
}

// ─── INCIDENTS INTERFACES ──────────────────────────────────────────────────
interface GetIncidentsInput {
  status?: 'open' | 'under_investigation' | 'resolved' | 'closed';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  location_id?: string;
  created_after?: string;           // YYYY-MM-DD
  limit?: number;                   // max results (default 20, max 100)
}

interface CreateIncidentInput {
  title: string;                    // required
  description: string;              // detailed incident description
  location_id: string;              // required UUID reference
  severity: 'low' | 'medium' | 'high' | 'critical';
  incident_type?: string;           // e.g., "Safety", "Hygiene", "Property Damage", "Conflict", "System Failure"
  involved_employee_ids?: string[]; // UUID references
  witnesses?: string;               // names or descriptions of witnesses
  report_by?: string;               // name of reporter (defaults to current user)
  occurred_at?: string;             // ISO timestamp (defaults to now)
  confirmed?: boolean;
}

interface UpdateIncidentInput {
  incident_id: string;              // required UUID
  title?: string;
  description?: string;
  status?: 'open' | 'under_investigation' | 'resolved' | 'closed';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  investigation_notes?: string;
  resolution_actions?: string;      // corrective actions taken
}

// ─── NOTIFICATIONS INTERFACES ──────────────────────────────────────────────
interface GetNotificationsInput {
  status?: 'unread' | 'read' | 'archived';
  type?: 'shift' | 'task' | 'announcement' | 'incident' | 'maintenance' | 'system';
  limit?: number;                   // max results (default 20, max 100)
}

interface UpdateNotificationInput {
  notification_id: string;          // required UUID
  status?: 'unread' | 'read' | 'archived';
  action?: 'mark_read' | 'mark_unread' | 'archive' | 'dismiss';
}

// ─── ACTIVITY TIMELINE INTERFACES ──────────────────────────────────────────
interface GetActivityInput {
  entity_type?: string;             // 'shift', 'task', 'employee', 'maintenance', 'incident', 'announcement', 'inventory'
  entity_id?: string;               // UUID of specific entity (optional)
  action?: 'created' | 'updated' | 'deleted' | 'completed' | 'acknowledged';
  actor_id?: string;                // UUID of user who performed action
  date_from?: string;               // YYYY-MM-DD
  date_to?: string;                 // YYYY-MM-DD
  location_id?: string;
  limit?: number;                   // max results (default 50, max 200)
}
```

---

## JSON Tool Definitions (Copy-Paste Ready)

Add these to the `TOOLS` array in `/app/api/brain/chat/route.ts`:

### SHIFT MANAGEMENT TOOLS

```json
{
  "type": "function",
  "name": "get_shifts",
  "description": "View scheduled shifts with filters. Examples: 'Show today\\'s shifts', 'List all open shifts', 'Who\\'s working tomorrow?', 'What shifts do we have next week?', 'Show Maroun\\'s shifts for the next 7 days'",
  "parameters": {
    "type": "object",
    "properties": {
      "status": {
        "type": "string",
        "enum": ["scheduled", "in_progress", "completed", "cancelled"],
        "description": "Filter by shift status"
      },
      "employee_name": {
        "type": "string",
        "description": "Filter by employee name (partial match)"
      },
      "location_id": {
        "type": "string",
        "description": "Filter by location UUID"
      },
      "date": {
        "type": "string",
        "description": "Filter by date: YYYY-MM-DD, 'today', 'tomorrow', 'this week', 'next week', or day name (e.g., 'Friday')"
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of results (default: 20, max: 100)"
      }
    },
    "required": []
  }
}
```

```json
{
  "type": "function",
  "name": "create_shift",
  "description": "Create and schedule a new shift for an employee. ALWAYS call with confirmed=false first to show a preview. Examples: 'Schedule Maroun for 9am-5pm today', 'Add a closing shift for Khaled tomorrow', 'Create a 2pm-10pm shift for the bar manager on Friday'",
  "parameters": {
    "type": "object",
    "properties": {
      "start_time": {
        "type": "string",
        "description": "Shift start time: HH:MM format (e.g., '09:00') or natural language (e.g., '9am', '2:30pm')"
      },
      "end_time": {
        "type": "string",
        "description": "Shift end time: HH:MM format or natural language (e.g., '5pm', '10:30pm')"
      },
      "shift_date": {
        "type": "string",
        "description": "Date of shift: YYYY-MM-DD format, 'today', 'tomorrow', or day name (e.g., 'Friday')"
      },
      "employee_name": {
        "type": "string",
        "description": "Name of employee to assign (auto-resolved to employee ID)"
      },
      "employee_id": {
        "type": "string",
        "description": "UUID of employee (use if name cannot be resolved)"
      },
      "location_id": {
        "type": "string",
        "description": "UUID of location where shift occurs (optional)"
      },
      "shift_type": {
        "type": "string",
        "enum": ["opening", "closing", "mid", "full"],
        "description": "Type of shift for classification (optional, default: full)"
      },
      "notes": {
        "type": "string",
        "description": "Optional notes about the shift (e.g., 'Bar Manager', 'Covering for Jawad')"
      },
      "confirmed": {
        "type": "boolean",
        "description": "false = show preview without inserting, true = execute after user confirms"
      }
    },
    "required": ["start_time", "end_time", "shift_date"]
  }
}
```

```json
{
  "type": "function",
  "name": "update_shift",
  "description": "Modify an existing shift (time, employee, date, status). Examples: 'Change Maroun\\'s shift to 10am-6pm', 'Move the closing shift to tomorrow', 'Mark the evening shift as completed'",
  "parameters": {
    "type": "object",
    "properties": {
      "shift_id": {
        "type": "string",
        "description": "UUID of the shift to update (required)"
      },
      "start_time": {
        "type": "string",
        "description": "New start time (HH:MM or natural language)"
      },
      "end_time": {
        "type": "string",
        "description": "New end time"
      },
      "shift_date": {
        "type": "string",
        "description": "New date"
      },
      "employee_name": {
        "type": "string",
        "description": "New employee name (auto-resolved)"
      },
      "employee_id": {
        "type": "string",
        "description": "New employee UUID"
      },
      "shift_type": {
        "type": "string",
        "enum": ["opening", "closing", "mid", "full"]
      },
      "status": {
        "type": "string",
        "enum": ["scheduled", "in_progress", "completed", "cancelled"],
        "description": "New shift status"
      },
      "notes": {
        "type": "string",
        "description": "Updated notes"
      }
    },
    "required": ["shift_id"]
  }
}
```

```json
{
  "type": "function",
  "name": "delete_shift",
  "description": "Remove a scheduled shift. Example: 'Cancel the 2pm shift for tomorrow'",
  "parameters": {
    "type": "object",
    "properties": {
      "shift_id": {
        "type": "string",
        "description": "UUID of the shift to delete (required)"
      }
    },
    "required": ["shift_id"]
  }
}
```

```json
{
  "type": "function",
  "name": "get_schedules",
  "description": "View shift schedules and staffing calendars for a period. Examples: 'Show the schedule for next week', 'What does the staffing look like for August?', 'Are there any scheduling conflicts?'",
  "parameters": {
    "type": "object",
    "properties": {
      "location_id": {
        "type": "string",
        "description": "Filter by location UUID (optional)"
      },
      "date_from": {
        "type": "string",
        "description": "Start date for schedule view: YYYY-MM-DD (default: today)"
      },
      "date_to": {
        "type": "string",
        "description": "End date for schedule view: YYYY-MM-DD (default: 7 days from today)"
      },
      "employee_id": {
        "type": "string",
        "description": "Filter to specific employee UUID (optional)"
      },
      "include_conflicts": {
        "type": "boolean",
        "description": "Include flagging of overlapping shifts or scheduling conflicts (default: true)"
      }
    },
    "required": []
  }
}
```

```json
{
  "type": "function",
  "name": "create_schedule",
  "description": "Create a new shift schedule or staffing calendar (e.g., seasonal schedules, recurring patterns). Examples: 'Create a summer schedule', 'Set up weekend coverage for Q3', 'Build the August staffing plan'",
  "parameters": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "Schedule name (e.g., 'Summer Season', 'August 2026', 'Holiday Coverage')"
      },
      "start_date": {
        "type": "string",
        "description": "Schedule start date (YYYY-MM-DD)"
      },
      "end_date": {
        "type": "string",
        "description": "Schedule end date (YYYY-MM-DD)"
      },
      "location_id": {
        "type": "string",
        "description": "UUID of location this schedule applies to (required)"
      },
      "description": {
        "type": "string",
        "description": "Optional description of the schedule"
      },
      "template_shifts": {
        "type": "array",
        "description": "Optional recurring shift template (day_of_week, start_time, end_time, shift_type)",
        "items": {
          "type": "object",
          "properties": {
            "day_of_week": {
              "type": "number",
              "description": "0=Sunday, 1=Monday, ..., 6=Saturday"
            },
            "start_time": {
              "type": "string",
              "description": "HH:MM format"
            },
            "end_time": {
              "type": "string",
              "description": "HH:MM format"
            },
            "shift_type": {
              "type": "string"
            }
          }
        }
      },
      "confirmed": {
        "type": "boolean",
        "description": "false = preview, true = create"
      }
    },
    "required": ["name", "start_date", "end_date", "location_id"]
  }
}
```

### MAINTENANCE TOOLS

```json
{
  "type": "function",
  "name": "get_maintenance_tickets",
  "description": "View maintenance tickets and repair requests. Examples: 'Show open maintenance tickets', 'What\\'s broken?', 'List all critical issues', 'Who\\'s assigned to maintenance today?', 'Show HVAC issues for the kitchen'",
  "parameters": {
    "type": "object",
    "properties": {
      "status": {
        "type": "string",
        "enum": ["open", "in_progress", "completed", "cancelled"],
        "description": "Filter by ticket status"
      },
      "priority": {
        "type": "string",
        "enum": ["low", "medium", "high", "critical"],
        "description": "Filter by priority level"
      },
      "location_id": {
        "type": "string",
        "description": "Filter by location UUID"
      },
      "assigned_to": {
        "type": "string",
        "description": "Filter by assigned employee name (partial match)"
      },
      "created_after": {
        "type": "string",
        "description": "Show tickets created after this date (YYYY-MM-DD)"
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of results (default: 20, max: 100)"
      }
    },
    "required": []
  }
}
```

```json
{
  "type": "function",
  "name": "create_maintenance_ticket",
  "description": "Report a maintenance issue or repair need. ALWAYS call with confirmed=false first for preview. Examples: 'The refrigerator is making a loud noise', 'Report a clogged sink in the bathroom', 'POS system crashed - critical', 'Door lock is broken on the back entrance'",
  "parameters": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "description": "Brief title of the issue (required)"
      },
      "description": {
        "type": "string",
        "description": "Detailed description of the problem (required)"
      },
      "location_id": {
        "type": "string",
        "description": "UUID of location where issue is (required)"
      },
      "asset_type": {
        "type": "string",
        "description": "Type of asset affected (e.g., 'HVAC', 'Refrigerator', 'POS System', 'Plumbing', 'Electrical', 'Door', 'Flooring')"
      },
      "priority": {
        "type": "string",
        "enum": ["low", "medium", "high", "critical"],
        "description": "Urgency level (default: medium). Use 'critical' for system failures or safety issues."
      },
      "assigned_to_name": {
        "type": "string",
        "description": "Name of technician/employee to assign (auto-resolved)"
      },
      "assigned_to_id": {
        "type": "string",
        "description": "UUID of assigned employee (use if name cannot be resolved)"
      },
      "estimated_duration": {
        "type": "number",
        "description": "Estimated repair time in minutes"
      },
      "notes": {
        "type": "string",
        "description": "Additional context or troubleshooting steps"
      },
      "confirmed": {
        "type": "boolean",
        "description": "false = preview, true = create ticket"
      }
    },
    "required": ["title", "description", "location_id"]
  }
}
```

```json
{
  "type": "function",
  "name": "update_maintenance_ticket",
  "description": "Update a maintenance ticket (status, priority, assignment, resolution). Examples: 'Mark the refrigerator repair as completed', 'Assign the POS issue to Jawad', 'Update to critical priority'",
  "parameters": {
    "type": "object",
    "properties": {
      "ticket_id": {
        "type": "string",
        "description": "UUID of the ticket to update (required)"
      },
      "title": {
        "type": "string",
        "description": "New issue title"
      },
      "description": {
        "type": "string",
        "description": "Updated description"
      },
      "priority": {
        "type": "string",
        "enum": ["low", "medium", "high", "critical"]
      },
      "status": {
        "type": "string",
        "enum": ["open", "in_progress", "completed", "cancelled"],
        "description": "New status"
      },
      "assigned_to_name": {
        "type": "string",
        "description": "Reassign to employee name (auto-resolved)"
      },
      "assigned_to_id": {
        "type": "string",
        "description": "Reassign to employee UUID"
      },
      "resolution_notes": {
        "type": "string",
        "description": "Notes on how the issue was resolved (use when marking completed)"
      },
      "actual_duration": {
        "type": "number",
        "description": "Actual time spent on repair (in minutes)"
      }
    },
    "required": ["ticket_id"]
  }
}
```

### ANNOUNCEMENTS TOOLS

```json
{
  "type": "function",
  "name": "get_announcements",
  "description": "View company announcements and broadcasts. Examples: 'Show recent announcements', 'What announcements are active?', 'Have I acknowledged all announcements?', 'List urgent announcements'",
  "parameters": {
    "type": "object",
    "properties": {
      "status": {
        "type": "string",
        "enum": ["draft", "published", "archived"],
        "description": "Filter by status"
      },
      "audience": {
        "type": "string",
        "enum": ["all_staff", "managers", "location_specific", "department_specific"],
        "description": "Filter by target audience"
      },
      "location_id": {
        "type": "string",
        "description": "Filter by location UUID (if location_specific announcements)"
      },
      "created_after": {
        "type": "string",
        "description": "Show announcements created after this date (YYYY-MM-DD)"
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of results (default: 20, max: 100)"
      }
    },
    "required": []
  }
}
```

```json
{
  "type": "function",
  "name": "create_announcement",
  "description": "Create and publish a company-wide or targeted announcement. ALWAYS call with confirmed=false first. Examples: 'Announce that the bar will be closed Monday', 'Send a message to all managers about new safety procedures', 'Post an urgent update for the kitchen staff'",
  "parameters": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "description": "Announcement title (required)"
      },
      "content": {
        "type": "string",
        "description": "Full announcement content/message (required). Can include HTML formatting or plain text."
      },
      "audience": {
        "type": "string",
        "enum": ["all_staff", "managers", "location_specific", "department_specific"],
        "description": "Target audience (required)"
      },
      "location_ids": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Required if audience='location_specific'. Array of location UUIDs."
      },
      "department_ids": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Required if audience='department_specific'. Array of department UUIDs."
      },
      "priority": {
        "type": "string",
        "enum": ["normal", "high", "urgent"],
        "description": "Priority level for highlighting (default: normal)"
      },
      "expires_at": {
        "type": "string",
        "description": "Optional expiration date (YYYY-MM-DD). Announcement auto-archives after this date."
      },
      "confirmed": {
        "type": "boolean",
        "description": "false = preview, true = publish"
      }
    },
    "required": ["title", "content", "audience"]
  }
}
```

```json
{
  "type": "function",
  "name": "update_announcement",
  "description": "Modify an existing announcement (title, content, audience, expiration). Examples: 'Update the closure notice to Tuesday', 'Archive the safety announcement', 'Extend the announcement deadline'",
  "parameters": {
    "type": "object",
    "properties": {
      "announcement_id": {
        "type": "string",
        "description": "UUID of announcement to update (required)"
      },
      "title": {
        "type": "string",
        "description": "New title"
      },
      "content": {
        "type": "string",
        "description": "New content"
      },
      "status": {
        "type": "string",
        "enum": ["draft", "published", "archived"],
        "description": "New status (e.g., archive the announcement)"
      },
      "audience": {
        "type": "string",
        "enum": ["all_staff", "managers", "location_specific", "department_specific"]
      },
      "location_ids": {
        "type": "array",
        "items": { "type": "string" }
      },
      "department_ids": {
        "type": "array",
        "items": { "type": "string" }
      },
      "priority": {
        "type": "string",
        "enum": ["normal", "high", "urgent"]
      },
      "expires_at": {
        "type": "string",
        "description": "YYYY-MM-DD format"
      }
    },
    "required": ["announcement_id"]
  }
}
```

```json
{
  "type": "function",
  "name": "delete_announcement",
  "description": "Remove an announcement. Example: 'Delete the old closure notice'",
  "parameters": {
    "type": "object",
    "properties": {
      "announcement_id": {
        "type": "string",
        "description": "UUID of announcement to delete (required)"
      }
    },
    "required": ["announcement_id"]
  }
}
```

```json
{
  "type": "function",
  "name": "record_acknowledgment",
  "description": "Mark that you have read/acknowledged an announcement. Example: 'I acknowledge the safety announcement'",
  "parameters": {
    "type": "object",
    "properties": {
      "announcement_id": {
        "type": "string",
        "description": "UUID of announcement to acknowledge (required)"
      },
      "employee_id": {
        "type": "string",
        "description": "UUID of acknowledging employee (auto-populated from current user if not provided)"
      },
      "acknowledged_at": {
        "type": "string",
        "description": "Timestamp of acknowledgment (defaults to current time)"
      }
    },
    "required": ["announcement_id"]
  }
}
```

### INCIDENTS TOOLS

```json
{
  "type": "function",
  "name": "get_incidents",
  "description": "View incident reports and safety issues. Examples: 'Show open incidents', 'What incidents have been reported?', 'List all critical incidents', 'Show incidents from today'",
  "parameters": {
    "type": "object",
    "properties": {
      "status": {
        "type": "string",
        "enum": ["open", "under_investigation", "resolved", "closed"],
        "description": "Filter by incident status"
      },
      "severity": {
        "type": "string",
        "enum": ["low", "medium", "high", "critical"],
        "description": "Filter by severity level"
      },
      "location_id": {
        "type": "string",
        "description": "Filter by location UUID"
      },
      "created_after": {
        "type": "string",
        "description": "Show incidents after this date (YYYY-MM-DD)"
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of results (default: 20, max: 100)"
      }
    },
    "required": []
  }
}
```

```json
{
  "type": "function",
  "name": "create_incident",
  "description": "Report a safety incident or workplace issue. ALWAYS call with confirmed=false first. Examples: 'An employee fell in the kitchen', 'Customer complaint about allergenic ingredient', 'Altercation between staff members', 'Equipment failure caused injury'",
  "parameters": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "description": "Incident title (required, e.g., 'Employee Slip and Fall')"
      },
      "description": {
        "type": "string",
        "description": "Detailed account of incident (required)"
      },
      "location_id": {
        "type": "string",
        "description": "UUID of location where incident occurred (required)"
      },
      "severity": {
        "type": "string",
        "enum": ["low", "medium", "high", "critical"],
        "description": "Severity level (required). Use 'critical' for injuries, safety hazards."
      },
      "incident_type": {
        "type": "string",
        "description": "Category of incident (e.g., 'Safety', 'Hygiene', 'Property Damage', 'Conflict', 'System Failure', 'Customer', 'Health')"
      },
      "involved_employee_ids": {
        "type": "array",
        "items": { "type": "string" },
        "description": "UUIDs of employees involved in incident"
      },
      "witnesses": {
        "type": "string",
        "description": "Names or descriptions of witnesses"
      },
      "report_by": {
        "type": "string",
        "description": "Name of person reporting (defaults to current user)"
      },
      "occurred_at": {
        "type": "string",
        "description": "ISO timestamp of when incident occurred (defaults to now)"
      },
      "confirmed": {
        "type": "boolean",
        "description": "false = preview, true = create report"
      }
    },
    "required": ["title", "description", "location_id", "severity"]
  }
}
```

```json
{
  "type": "function",
  "name": "update_incident",
  "description": "Update an incident report (status, severity, investigation notes, resolution). Examples: 'Mark incident as resolved', 'Update to critical severity', 'Add investigation findings'",
  "parameters": {
    "type": "object",
    "properties": {
      "incident_id": {
        "type": "string",
        "description": "UUID of incident to update (required)"
      },
      "title": {
        "type": "string",
        "description": "New title"
      },
      "description": {
        "type": "string",
        "description": "Updated description"
      },
      "status": {
        "type": "string",
        "enum": ["open", "under_investigation", "resolved", "closed"],
        "description": "New status"
      },
      "severity": {
        "type": "string",
        "enum": ["low", "medium", "high", "critical"]
      },
      "investigation_notes": {
        "type": "string",
        "description": "Findings from investigation"
      },
      "resolution_actions": {
        "type": "string",
        "description": "Corrective actions taken or recommended"
      }
    },
    "required": ["incident_id"]
  }
}
```

### NOTIFICATIONS TOOLS

```json
{
  "type": "function",
  "name": "get_notifications",
  "description": "View your notifications inbox. Examples: 'Show my unread notifications', 'List shift assignments', 'What task notifications do I have?', 'Show incident alerts'",
  "parameters": {
    "type": "object",
    "properties": {
      "status": {
        "type": "string",
        "enum": ["unread", "read", "archived"],
        "description": "Filter by read status"
      },
      "type": {
        "type": "string",
        "enum": ["shift", "task", "announcement", "incident", "maintenance", "system"],
        "description": "Filter by notification type"
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of results (default: 20, max: 100)"
      }
    },
    "required": []
  }
}
```

```json
{
  "type": "function",
  "name": "update_notification",
  "description": "Manage notification status (mark read, archive, dismiss). Examples: 'Mark all notifications as read', 'Archive this notification', 'Dismiss the alert'",
  "parameters": {
    "type": "object",
    "properties": {
      "notification_id": {
        "type": "string",
        "description": "UUID of notification to update (required)"
      },
      "status": {
        "type": "string",
        "enum": ["unread", "read", "archived"],
        "description": "New notification status"
      },
      "action": {
        "type": "string",
        "enum": ["mark_read", "mark_unread", "archive", "dismiss"],
        "description": "Action to perform on notification"
      }
    },
    "required": ["notification_id"]
  }
}
```

### ACTIVITY TIMELINE TOOL

```json
{
  "type": "function",
  "name": "get_activity",
  "description": "View the activity timeline and audit log. Examples: 'Show recent activity', 'Who created this task?', 'When was the announcement published?', 'Show all employee updates', 'View activity for the bar location'",
  "parameters": {
    "type": "object",
    "properties": {
      "entity_type": {
        "type": "string",
        "description": "Filter by entity type: 'shift', 'task', 'employee', 'maintenance', 'incident', 'announcement', 'inventory', etc."
      },
      "entity_id": {
        "type": "string",
        "description": "UUID of specific entity to see all activity for (optional)"
      },
      "action": {
        "type": "string",
        "enum": ["created", "updated", "deleted", "completed", "acknowledged"],
        "description": "Filter by action type"
      },
      "actor_id": {
        "type": "string",
        "description": "UUID of user who performed the action (optional)"
      },
      "date_from": {
        "type": "string",
        "description": "Show activity after this date (YYYY-MM-DD, default: 30 days ago)"
      },
      "date_to": {
        "type": "string",
        "description": "Show activity before this date (YYYY-MM-DD, default: today)"
      },
      "location_id": {
        "type": "string",
        "description": "Filter by location UUID (optional)"
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of results (default: 50, max: 200)"
      }
    },
    "required": []
  }
}
```

---

## Usage Examples by Module

### Shift Management Examples
- **View shifts:** "Show today's shifts" → `get_shifts` with `date='today'`
- **Schedule a shift:** "Schedule Maroun for 9am-5pm tomorrow" → `create_shift` with confirmation flow
- **View schedule:** "What's the staffing plan for next week?" → `get_schedules` with `date_from` and `date_to`
- **Modify shift:** "Move the closing shift to 11pm" → `update_shift` with `end_time='11pm'`

### Maintenance Examples
- **Report issue:** "The refrigerator is broken" → `create_maintenance_ticket` with `priority='critical'`
- **Check tickets:** "What maintenance is pending?" → `get_maintenance_tickets` with `status='open'`
- **Complete repair:** "Mark the HVAC repair as done" → `update_maintenance_ticket` with `status='completed'`

### Announcements Examples
- **Broadcast message:** "Announce that we're closed Monday" → `create_announcement` with `audience='all_staff'`
- **View announcements:** "What announcements are active?" → `get_announcements` with `status='published'`
- **Acknowledge:** "I've read the safety announcement" → `record_acknowledgment`

### Incidents Examples
- **Report incident:** "An employee fell in the kitchen" → `create_incident` with `severity='critical'`
- **Check incidents:** "Show today's incidents" → `get_incidents` with `created_after=today`
- **Investigate:** "Update incident status to under investigation" → `update_incident` with `status='under_investigation'`

### Notifications Examples
- **Check inbox:** "Show my unread notifications" → `get_notifications` with `status='unread'`
- **Manage notification:** "Mark all as read" → `update_notification` with `status='read'` (call for each)

### Activity Timeline Examples
- **Audit log:** "Who created that task?" → `get_activity` with `entity_type='task'`
- **View updates:** "Show all changes to employees" → `get_activity` with `entity_type='employee'`, `action='updated'`
- **Recent changes:** "What happened today?" → `get_activity` with `date_from='today'`

---

## Natural Language Processing Guidance for AI

### For Shift Management:
- Parse time expressions: "9am" → "09:00", "2:30pm" → "14:30"
- Parse date expressions: "next Friday" → calculate actual date
- Classify shifts: "Opening shift" → `shift_type='opening'`
- Resolve employee names automatically when mentioned

### For Maintenance:
- Map severity: "broken" → priority='critical', "not working right" → priority='high'
- Detect asset types from descriptions: "refrigerator", "POS", "door lock", etc.
- Urgency keywords: "immediately" → critical, "soon" → high

### For Announcements:
- Detect audience from scope: "Tell managers" → audience='managers'
- Detect urgency: "Urgent update" → priority='urgent'
- Parse expiration: "until Friday" → expires_at=Friday

### For Incidents:
- Severity detection: "injury" → critical, "customer complaint" → medium
- Witness identification: capture names mentioned
- Timeline reconstruction: use `occurred_at` to timestamp precisely

---

## Confirmation Flow (All Write Operations)

**Pattern for all mutation tools:**
1. User requests action with parameters
2. Tool called with `confirmed=false` (default)
3. System returns structured preview showing what WILL happen
4. Display preview to user in conversational format
5. User explicitly confirms ("Confirm", "Yes, proceed", "Create them")
6. Tool called again with `confirmed=true` and same parameters
7. Mutation executed and success message returned

**Do NOT skip confirmation** — always show a preview first unless the user explicitly confirms in the same message.
