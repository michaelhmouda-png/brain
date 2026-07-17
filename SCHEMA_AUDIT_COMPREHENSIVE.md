# COMPREHENSIVE PHASE 1 SCHEMA AUDIT - ALL MISMATCHES FOUND

**Date**: 2026-07-17  
**Status**: CRITICAL MISMATCHES IDENTIFIED  
**Build Status**: 0 errors (but 5+ schema violations will cause runtime PGRST errors)

---

## EXECUTIVE SUMMARY

Found **7 major schema mismatches** across Phase 1 modules:

1. ❌ **CRITICAL**: maintenance_tickets service uses `area`/`equipment` instead of `location_id`
2. ❌ **CRITICAL**: incident_reports service uses `location`/`people_involved`/`photos_urls`/`actions_taken` (fields don't exist)
3. ❌ **CRITICAL**: shift_templates table missing `created_by_id` field entirely
4. ⚠️  **WARNING**: Inconsistent creator field naming (created_by vs created_by_id)
5. ⚠️  **WARNING**: maintenance API routes pass wrong field names
6. ⚠️  **WARNING**: incidents API routes pass wrong field names
7. ⚠️  **MINOR**: announcements service not using optional target_roles field

---

## DETAILED FINDINGS BY MODULE

### 1. MAINTENANCE_TICKETS (CRITICAL)

**Location**: `lib/maintenance.ts` lines 83-91

**Problem Code**:
```typescript
async createTicket(
  title: string,
  description: string,
  priority: 'low' | 'medium' | 'high' | 'critical',
  area: string,                    // ❌ DOES NOT EXIST IN SCHEMA
  equipment: string,               // ❌ DOES NOT EXIST IN SCHEMA
  assignedToId: string | null,
  dueDate: string | null,
  createdByUserId: string
) {
  const { data, error } = await this.supabase
    .from('maintenance_tickets')
    .insert({
      company_id: this.companyId,
      title,
      description,
      priority,
      area,                        // ❌ Trying to insert non-existent column
      equipment,                   // ❌ Trying to insert non-existent column
      assigned_to_id: assignedToId,
      due_date: dueDate,
      created_by_id: createdByUserId,
    })
```

**Expected Schema** (line 259 in hospibrain_phase1_schemas.sql):
```sql
CREATE TABLE IF NOT EXISTS maintenance_tickets (
  ...
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,  -- ✅ Correct field
  assigned_to_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  due_date DATE,
  ...
  created_by_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
);
```

**Error You'll See**: `PGRST204 "Could not find 'area' column of 'maintenance_tickets'"`

**Fix Required**: 
- ✅ Remove `area` and `equipment` parameters from `createTicket()` method
- ✅ Accept `location_id: string | null` parameter instead
- ✅ Insert `location_id` into database (optional, can be null)

---

### 2. INCIDENT_REPORTS (CRITICAL)

**Location**: `lib/incidents.ts` lines 65-93

**Problem Code**:
```typescript
async createIncident(
  title: string,
  description: string,
  incidentType: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  location: string,                           // ❌ DOES NOT EXIST (use location_id)
  incidentTime: string,
  peopleInvolved: string[],                   // ❌ DOES NOT EXIST IN SCHEMA
  actionsTaken: string,                       // ❌ DOES NOT EXIST IN SCHEMA
  reportedByUserId: string,
  photosUrls?: string[]                       // ❌ DOES NOT EXIST IN SCHEMA
) {
  const { data, error } = await this.supabase
    .from('incident_reports')
    .insert({
      company_id: this.companyId,
      title,
      description,
      incident_type: incidentType,
      severity,
      location,                      // ❌ Wrong: should be location_id UUID
      incident_time: incidentTime,
      people_involved: peopleInvolved, // ❌ Column doesn't exist
      photos_urls: photosUrls || [], // ❌ Column doesn't exist
      actions_taken: actionsTaken,   // ❌ Column doesn't exist
      reported_by_id: reportedByUserId,
    })
```

**Expected Schema** (lines 305-335 in hospibrain_phase1_schemas.sql):
```sql
CREATE TABLE IF NOT EXISTS incident_reports (
  ...
  incident_type TEXT CHECK (incident_type IN ('guest_injury', 'employee_injury', 'fight', 'power_outage', 'equipment_failure', 'lost_item', 'other')),
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,  -- ✅ Correct
  affected_area TEXT,                                            -- ✅ Correct  
  incident_time TIMESTAMP WITH TIME ZONE NOT NULL,
  reported_by_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
);
-- NOT IN SCHEMA: people_involved, photos_urls, actions_taken, location (text)
```

**Error You'll See**: Multiple PGRST204 errors:
- `"Could not find 'location' column of 'incident_reports'"`
- `"Could not find 'people_involved' column of 'incident_reports'"`
- `"Could not find 'photos_urls' column of 'incident_reports'"`
- `"Could not find 'actions_taken' column of 'incident_reports'"`

**Fix Required**:
- ✅ Remove `location` parameter, use `location_id: string | null` instead
- ✅ Remove `peopleInvolved: string[]` parameter entirely
- ✅ Remove `photosUrls?: string[]` parameter entirely
- ✅ Remove `actionsTaken: string` parameter entirely
- ✅ Accept optional `affected_area: string | null` parameter
- ✅ Insert `location_id` and `affected_area` into database

---

### 3. SHIFT_TEMPLATES (CRITICAL)

**Location**: Schema definition (hospibrain_phase1_schemas.sql line 124-132)

**Problem**: Table has no creator tracking at all

**Current Schema**:
```sql
CREATE TABLE IF NOT EXISTS shift_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_minutes INT DEFAULT 0,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- ❌ MISSING: created_by_id or created_by
  CONSTRAINT valid_company CHECK (company_id IS NOT NULL)
);
```

**Fix Required**: Add creator tracking to shift_templates

---

### 4. CREATOR FIELD NAMING INCONSISTENCY

**Tables with `created_by_id` (correct pattern)**:
- shifts (line 145)
- maintenance_tickets (line 270)
- announcements (line 281)
- incident_reports (uses `reported_by_id` on line 321)

**Tables with `created_by` (old pattern)**:
- weekly_schedules (line 162)
- recurring_shifts (line 182)
- open_shifts (line 196)

**Tables with `created_by` in code but schema unclear**:
- shift_templates (MISSING entirely)

**Recommendation**: Standardize all to `created_by_id` for consistency

**Impact**: Code in `lib/shift-management.ts` uses `created_by` which matches weekly_schedules/recurring_shifts, but is inconsistent with the newer tables.

---

### 5. MAINTENANCE API ROUTE MISMATCH

**Location**: `app/api/maintenance/route.ts` line 79-88

**Problem Code**:
```typescript
const ticket = await maintenanceService.createTicket(
  data.title,
  data.description,
  data.priority || 'medium',
  data.area,                    // ❌ API passes area, but service expects it
  data.equipment,               // ❌ API passes equipment, but service expects it
  data.assignedToId || null,
  data.dueDate || null,
  user.id
);
```

**Issue**: API route passes wrong fields (inherited from old service design)

**Fix**: Update API route to accept `location_id` parameter

---

### 6. INCIDENTS API ROUTE MISMATCH

**Location**: `app/api/incidents/route.ts` line 74-85

**Problem Code**:
```typescript
const incident = await incidentsService.createIncident(
  data.title,
  data.description,
  data.incidentType,
  data.severity || 'medium',
  data.location,                // ❌ API passes location (text)
  data.incidentTime,
  data.peopleInvolved || [],    // ❌ API passes peopleInvolved (not in schema)
  data.actionsTaken,            // ❌ API passes actionsTaken (not in schema)
  user.id,
  data.photosUrls || []         // ❌ API passes photosUrls (not in schema)
);
```

**Fix**: Update API route to accept `location_id`, `affected_area`

---

### 7. ANNOUNCEMENTS - MISSING TARGET_ROLES (MINOR)

**Location**: `lib/announcements.ts` line 41-62

**Current Code** (doesn't use target_roles):
```typescript
async createAnnouncement(
  title: string,
  content: string,
  priority: 'low' | 'normal' | 'high' | 'urgent',
  createdByUserId: string,
  expiresAt?: string
) {
  const { data, error } = await this.supabase
    .from('announcements')
    .insert({
      company_id: this.companyId,
      title,
      content,
      priority,
      created_by_id: createdByUserId,
      expires_at: expiresAt,
      // ⚠️ MISSING: target_roles (optional, has default)
    })
```

**Schema** (line 280):
```sql
target_roles TEXT[] DEFAULT '{}',  -- Optional field
```

**Note**: This is LOW priority since the field has a default value. The code works, but doesn't leverage the target_roles feature.

**Fix**: Optional - accept `target_roles?: string[]` parameter

---

## SUMMARY TABLE

| Module | Issue | Severity | Type |
|--------|-------|----------|------|
| maintenance_tickets | Uses area/equipment instead of location_id | CRITICAL | Schema Violation |
| incident_reports | Uses location/people_involved/photos_urls/actions_taken | CRITICAL | Schema Violation |
| shift_templates | Missing created_by_id field | CRITICAL | Missing Column |
| lib/maintenance.ts | Wrong parameters | CRITICAL | Code Mismatch |
| lib/incidents.ts | Wrong parameters | CRITICAL | Code Mismatch |
| app/api/maintenance/route.ts | Wrong field names | HIGH | API Route |
| app/api/incidents/route.ts | Wrong field names | HIGH | API Route |
| announcements | Not using target_roles | LOW | Unused Feature |
| Creator field naming | Inconsistent (created_by vs created_by_id) | MEDIUM | Inconsistency |

---

## WHAT HAPPENS WHEN YOU RUN npm run build NOW

✅ Build will compile successfully (0 TypeScript errors)
❌ Runtime WILL FAIL with Supabase errors like:
- `PGRST204: Could not find 'area' column of 'maintenance_tickets'`
- `PGRST204: Could not find 'location' column of 'incident_reports'`
- `PGRST204: Could not find 'people_involved' column of 'incident_reports'`

These will only appear when:
1. User tries to create maintenance ticket via API
2. User tries to report incident via API
3. User tries to create maintenance via chat interface
4. User tries to create incident via chat interface

---

## FILES REQUIRING CHANGES

### Database Schema
- [ ] `hospibrain_phase1_schemas.sql` - Add `created_by_id` to shift_templates

### Service Layer
- [ ] `lib/maintenance.ts` - Update createTicket() signature
- [ ] `lib/incidents.ts` - Update createIncident() signature

### API Routes
- [ ] `app/api/maintenance/route.ts` - Update field mapping
- [ ] `app/api/incidents/route.ts` - Update field mapping

### Brain Chat Handlers
- [ ] `app/api/brain/chat/route.ts` - Verify handlers (likely already correct)

---

## IMMEDIATE ACTION REQUIRED

1. Update service layer signatures (lib/maintenance.ts, lib/incidents.ts)
2. Update API routes to pass correct field names
3. Add created_by_id to shift_templates schema
4. Run migration to add shift_templates.created_by_id
5. Run npm run build
6. Test create maintenance, create incident operations
