/**
 * PHASE 0: Diagnostic Debug Endpoint
 *
 * POST /api/brain/debug/tasks
 *
 * Development-only endpoint for testing task operations directly,
 * without going through the AI layer.
 *
 * Uses the same authenticated Supabase client and RLS policies.
 *
 * Actions:
 * - find: Search for a task by title, employee, due date
 * - update: Update a specific task with canonical values
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import {
  TASK_STATUS,
  TASK_PRIORITY,
  displayTaskStatus,
  displayTaskPriority,
  canonicalPriority,
  canonicalStatus,
  isValidTaskPriority,
  isValidTaskStatus,
} from '@/lib/brain/taskConstants';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // Only allow in non-production environments
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'This endpoint is only available in development mode' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const { action, title, assignedEmployeeName, dueDate, taskId, updates } = body;

    console.log('[Brain Debug] Request received:', { action, title, assignedEmployeeName, dueDate, taskId });

    // Authenticate user and get company_id
    const supabase = await createSupabaseServerAuth();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Not authenticated', code: 'AUTH_FAILED' },
        { status: 401 }
      );
    }

    // Get user profile and company_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, company_id, role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Profile not found', code: 'PROFILE_NOT_FOUND' },
        { status: 400 }
      );
    }

    const companyId = profile.company_id;

    // ────────────────────────────────────────────────────────────────
    // ACTION: find
    // ────────────────────────────────────────────────────────────────
    if (action === 'find') {
      console.log('[Brain Debug] find action:', { title, assignedEmployeeName, dueDate });

      let query = supabase
        .from('tasks')
        .select('id, title, priority, status, due_date, assigned_employee_id, employees(first_name, last_name)')
        .eq('company_id', companyId);

      // Filter by title (exact match, case-insensitive)
      if (title) {
        query = query.ilike('title', `%${title}%`);
      }

      // Filter by due date
      if (dueDate) {
        query = query.eq('due_date', dueDate);
      }

      const { data: tasks, error: queryError } = await query;

      if (queryError) {
        console.error('[Brain Debug] Query error:', queryError);
        return NextResponse.json(
          {
            success: false,
            stage: 'task_search',
            error: queryError.message,
            code: queryError.code,
            details: queryError.details,
            hint: queryError.hint,
          },
          { status: 400 }
        );
      }

      if (!tasks || tasks.length === 0) {
        console.log('[Brain Debug] No tasks found');
        return NextResponse.json({
          success: false,
          stage: 'task_search',
          error: 'No tasks found matching the criteria',
          criteria: { title, assignedEmployeeName, dueDate },
        });
      }

      // Filter by assigned employee (client-side after fetching)
      let filtered = tasks;
      if (assignedEmployeeName) {
        const nameParts = assignedEmployeeName.trim().toLowerCase().split(/\s+/);
        filtered = tasks.filter((task: any) => {
          if (!task.employees) return false;
          const empName = `${task.employees.first_name} ${task.employees.last_name}`.toLowerCase();
          return nameParts.every((part: string) => empName.includes(part));
        });
      }

      if (filtered.length === 0) {
        return NextResponse.json({
          success: false,
          stage: 'task_search',
          error: `No tasks found matching: title="${title}", employee="${assignedEmployeeName}", due_date="${dueDate}"`,
          foundCount: tasks.length,
          filteredCount: filtered.length,
        });
      }

      if (filtered.length > 1) {
        return NextResponse.json({
          success: false,
          stage: 'task_search_multiple',
          error: `Multiple tasks match the criteria. Please be more specific.`,
          foundCount: filtered.length,
          candidates: filtered.map((t: any) => ({
            id: t.id,
            title: t.title,
            priority: displayTaskPriority(t.priority),
            status: displayTaskStatus(t.status),
            due_date: t.due_date,
            assigned_to: t.employees ? `${t.employees.first_name} ${t.employees.last_name}` : 'Unassigned',
          })),
        });
      }

      const task = filtered[0];
      return NextResponse.json({
        success: true,
        task: {
          id: task.id,
          title: task.title,
          priority: displayTaskPriority(task.priority),
          priority_db: task.priority,  // Show actual database value
          status: displayTaskStatus(task.status),
          status_db: task.status,      // Show actual database value
          due_date: task.due_date,
          assigned_to: task.employees ? `${task.employees.first_name} ${task.employees.last_name}` : 'Unassigned',
          assigned_employee_id: task.assigned_employee_id,
        },
      });
    }

    // ────────────────────────────────────────────────────────────────
    // ACTION: update
    // ────────────────────────────────────────────────────────────────
    if (action === 'update') {
      if (!taskId) {
        return NextResponse.json(
          { success: false, stage: 'validation', error: 'taskId is required for update action' },
          { status: 400 }
        );
      }

      if (!updates || typeof updates !== 'object') {
        return NextResponse.json(
          { success: false, stage: 'validation', error: 'updates object is required' },
          { status: 400 }
        );
      }

      console.log('[Brain Debug] update action:', { taskId, updates });

      // Build canonical update object
      const updatePayload: Record<string, unknown> = {};

      if (updates.priority) {
        const canonical = canonicalPriority(updates.priority);
        if (!canonical) {
          console.log('[Brain Debug] Invalid priority:', updates.priority);
          return NextResponse.json(
            {
              success: false,
              stage: 'validation',
              error: `Invalid priority value: "${updates.priority}". Must be one of: ${Object.values(TASK_PRIORITY).join(', ')}`,
            },
            { status: 400 }
          );
        }
        updatePayload.priority = canonical;
        console.log('[Brain Debug] Priority normalized:', updates.priority, '->', canonical);
      }

      if (updates.status) {
        const canonical = canonicalStatus(updates.status);
        if (!canonical) {
          console.log('[Brain Debug] Invalid status:', updates.status);
          return NextResponse.json(
            {
              success: false,
              stage: 'validation',
              error: `Invalid status value: "${updates.status}". Must be one of: ${Object.values(TASK_STATUS).join(', ')}`,
            },
            { status: 400 }
          );
        }
        updatePayload.status = canonical;
        console.log('[Brain Debug] Status normalized:', updates.status, '->', canonical);
      }

      if (updates.title) {
        updatePayload.title = updates.title;
      }

      if (updates.description) {
        updatePayload.description = updates.description;
      }

      if (updates.due_date) {
        updatePayload.due_date = updates.due_date;
      }

      if (Object.keys(updatePayload).length === 0) {
        return NextResponse.json(
          { success: false, stage: 'validation', error: 'No valid fields provided for update' },
          { status: 400 }
        );
      }

      console.log('[Brain Debug] Update payload (canonical values):', updatePayload);

      // Execute update with RLS enforced
      const { data: updated, error: updateError } = await supabase
        .from('tasks')
        .update(updatePayload)
        .eq('id', taskId)
        .eq('company_id', companyId)
        .select('id, title, priority, status, due_date, assigned_employee_id')
        .single();

      if (updateError) {
        console.error('[Brain Debug] Supabase update error:', updateError);
        return NextResponse.json(
          {
            success: false,
            stage: 'supabase_update',
            error: updateError.message,
            code: updateError.code,
            details: updateError.details,
            hint: updateError.hint,
          },
          { status: 400 }
        );
      }

      if (!updated) {
        return NextResponse.json(
          {
            success: false,
            stage: 'supabase_update',
            error: `Task with ID ${taskId} not found or you don't have permission to update it.`,
          },
          { status: 404 }
        );
      }

      console.log('[Brain Debug] Update successful:', updated);

      return NextResponse.json({
        success: true,
        task: {
          id: updated.id,
          title: updated.title,
          priority: displayTaskPriority(updated.priority),
          priority_db: updated.priority,  // Show actual database value
          status: displayTaskStatus(updated.status),
          status_db: updated.status,      // Show actual database value
          due_date: updated.due_date,
          assigned_employee_id: updated.assigned_employee_id,
        },
      });
    }

    // Unsupported action
    return NextResponse.json(
      { success: false, error: `Unsupported action: "${action}". Use "find" or "update".` },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('[Brain Debug] Unexpected error:', error);
    return NextResponse.json(
      {
        success: false,
        stage: 'unexpected_error',
        error: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
