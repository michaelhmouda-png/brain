import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Business Events Service
 * Handles creation of timeline events for all major business actions
 * Events are created AFTER the main action succeeds
 * Event failure does not undo the main action
 */

export interface BusinessEvent {
  location_id?: string;
  event_type: string;
  module: string;
  title: string;
  description?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  actor_user_id?: string;
  employee_id?: string;
  customer_id?: string;
  task_id?: string;
  inventory_item_id?: string;
  metadata?: Record<string, any>;
}

export class BusinessEventsService {
  constructor(private supabase: SupabaseClient, private userCompanyId: string) {}

  /**
   * Create a business event safely
   * Failures are logged but do not throw
   */
  async createEvent(event: BusinessEvent): Promise<boolean> {
    try {
      const { error } = await this.supabase.from('business_events').insert({
        company_id: this.userCompanyId,
        ...event,
        occurred_at: new Date().toISOString(),
      });

      if (error) {
        console.error(`Failed to create business event (${event.event_type}):`, error);
        return false;
      }

      return true;
    } catch (err) {
      console.error(`Exception creating business event (${event.event_type}):`, err);
      return false;
    }
  }

  /**
   * Create a task_created event
   */
  async logTaskCreated(
    taskId: string,
    title: string,
    assignedEmployeeId?: string,
    dueDate?: string
  ): Promise<boolean> {
    let description = `Task created: ${title}`;
    if (assignedEmployeeId) {
      description += ` (pending assignment to employee)`;
    }
    if (dueDate) {
      description += ` due on ${dueDate}`;
    }

    return this.createEvent({
      event_type: 'task_created',
      module: 'Tasks',
      title: `Task created: ${title}`,
      description,
      task_id: taskId,
      employee_id: assignedEmployeeId,
      metadata: { due_date: dueDate },
    });
  }

  /**
   * Create a task_assigned event
   */
  async logTaskAssigned(
    taskId: string,
    taskTitle: string,
    employeeId: string,
    employeeName?: string
  ): Promise<boolean> {
    return this.createEvent({
      event_type: 'task_assigned',
      module: 'Tasks',
      title: `${taskTitle} assigned to ${employeeName || 'employee'}`,
      description: `Task reassigned or newly assigned`,
      task_id: taskId,
      employee_id: employeeId,
      metadata: { employee_name: employeeName },
    });
  }

  /**
   * Create a task_completed event
   */
  async logTaskCompleted(
    taskId: string,
    taskTitle: string,
    employeeId?: string,
    employeeName?: string
  ): Promise<boolean> {
    const title = employeeName ? `${employeeName} completed ${taskTitle}` : `Task completed: ${taskTitle}`;
    return this.createEvent({
      event_type: 'task_completed',
      module: 'Tasks',
      title,
      description: 'Task status updated to Completed',
      severity: 'high',
      task_id: taskId,
      employee_id: employeeId,
      metadata: { employee_name: employeeName },
    });
  }

  /**
   * Create a task_overdue event
   */
  async logTaskOverdue(
    taskId: string,
    taskTitle: string,
    dueDate: string
  ): Promise<boolean> {
    return this.createEvent({
      event_type: 'task_overdue',
      module: 'Tasks',
      title: `Task overdue: ${taskTitle}`,
      description: `Was due on ${dueDate}`,
      severity: 'critical',
      task_id: taskId,
    });
  }

  /**
   * Create an inventory_movement event
   */
  async logInventoryMovement(
    inventoryItemId: string,
    itemName: string,
    movementType: 'in' | 'out' | 'adjustment' | 'waste',
    quantity: number,
    reason?: string
  ): Promise<boolean> {
    const descriptions: Record<string, string> = {
      in: `${itemName} received: +${quantity} units`,
      out: `${itemName} used/sold: -${quantity} units`,
      adjustment: `${itemName} adjustment: ${quantity > 0 ? '+' : ''}${quantity} units`,
      waste: `${itemName} waste recorded: -${quantity} units`,
    };

    return this.createEvent({
      event_type: 'inventory_movement',
      module: 'Inventory',
      title: descriptions[movementType] || `Inventory movement: ${itemName}`,
      description: reason || undefined,
      inventory_item_id: inventoryItemId,
      metadata: { movement_type: movementType, quantity, reason },
    });
  }

  /**
   * Create a low_stock_detected event
   */
  async logLowStockDetected(
    inventoryItemId: string,
    itemName: string,
    currentQuantity: number,
    minimumQuantity: number
  ): Promise<boolean> {
    return this.createEvent({
      event_type: 'low_stock_detected',
      module: 'Inventory',
      title: `Low stock alert: ${itemName}`,
      description: `Current: ${currentQuantity} units, Minimum: ${minimumQuantity} units`,
      severity: 'high',
      inventory_item_id: inventoryItemId,
      metadata: { current_quantity: currentQuantity, minimum_quantity: minimumQuantity },
    });
  }

  /**
   * Create a customer_interaction event
   */
  async logCustomerInteraction(
    customerId: string,
    customerName: string,
    interactionType: string,
    description?: string
  ): Promise<boolean> {
    return this.createEvent({
      event_type: 'customer_interaction',
      module: 'Customers',
      title: `Customer interaction: ${customerName}`,
      description: description || interactionType,
      customer_id: customerId,
      metadata: { interaction_type: interactionType },
    });
  }

  /**
   * Create a customer_complaint event
   */
  async logCustomerComplaint(
    customerId: string,
    customerName: string,
    complaintDescription: string
  ): Promise<boolean> {
    return this.createEvent({
      event_type: 'customer_complaint',
      module: 'Customers',
      title: `Customer complaint: ${customerName}`,
      description: complaintDescription,
      severity: 'high',
      customer_id: customerId,
      metadata: { complaint: complaintDescription },
    });
  }

  /**
   * Create an employee_created event
   */
  async logEmployeeCreated(
    employeeId: string,
    employeeName: string
  ): Promise<boolean> {
    return this.createEvent({
      event_type: 'employee_created',
      module: 'Employees',
      title: `New employee added: ${employeeName}`,
      description: 'Employee record created',
      employee_id: employeeId,
      metadata: { employee_name: employeeName },
    });
  }

  /**
   * Create an employee_updated event
   */
  async logEmployeeUpdated(
    employeeId: string,
    employeeName: string,
    updatedFields: string[]
  ): Promise<boolean> {
    return this.createEvent({
      event_type: 'employee_updated',
      module: 'Employees',
      title: `Employee profile updated: ${employeeName}`,
      description: `Updated: ${updatedFields.join(', ')}`,
      employee_id: employeeId,
      metadata: { employee_name: employeeName, updated_fields: updatedFields },
    });
  }

  /**
   * Create a brain_score_changed event
   */
  async logBrainScoreChanged(
    previousScore: number,
    newScore: number,
    categories: Record<string, number>
  ): Promise<boolean> {
    const change = newScore - previousScore;
    const direction = change > 0 ? 'increased' : change < 0 ? 'decreased' : 'remained';
    const severity: 'critical' | 'high' | 'medium' | 'low' = 
      newScore < 60 ? 'critical' : newScore < 70 ? 'high' : newScore >= 80 ? 'low' : 'medium';

    return this.createEvent({
      event_type: 'brain_score_changed',
      module: 'Brain',
      title: `Brain Score ${direction} from ${previousScore} to ${newScore}`,
      description: `Change: ${change > 0 ? '+' : ''}${change}`,
      severity,
      metadata: { previous_score: previousScore, new_score: newScore, categories },
    });
  }

  /**
   * Get recent events for dashboard timeline
   * Limited to latest 10 by default
   */
  async getRecentEvents(limit: number = 10) {
    const { data, error } = await this.supabase
      .from('business_events')
      .select('*')
      .eq('company_id', this.userCompanyId)
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to fetch business events:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Get events filtered by module
   */
  async getEventsByModule(module: string, limit: number = 20) {
    const { data, error } = await this.supabase
      .from('business_events')
      .select('*')
      .eq('company_id', this.userCompanyId)
      .eq('module', module)
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`Failed to fetch ${module} events:`, error);
      return [];
    }

    return data || [];
  }

  /**
   * Get events filtered by event type
   */
  async getEventsByType(eventType: string, limit: number = 20) {
    const { data, error } = await this.supabase
      .from('business_events')
      .select('*')
      .eq('company_id', this.userCompanyId)
      .eq('event_type', eventType)
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`Failed to fetch ${eventType} events:`, error);
      return [];
    }

    return data || [];
  }

  /**
   * Get critical/high severity events (for alerts)
   */
  async getCriticalEvents(limit: number = 10) {
    const { data, error } = await this.supabase
      .from('business_events')
      .select('*')
      .eq('company_id', this.userCompanyId)
      .in('severity', ['critical', 'high'])
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to fetch critical events:', error);
      return [];
    }

    return data || [];
  }
}
