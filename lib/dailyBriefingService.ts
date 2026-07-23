import type { SupabaseClient } from '@supabase/supabase-js';
import { BrainScoreService } from './brainScoreService';
import { isTaskOverdue, loadTaskSnapshot, type TaskMetricRow } from './task-metrics.server';
import {
  isEmployeeProfileComplete,
  loadActiveEmployeeProfileSnapshot,
  type EmployeeProfileCompletenessRow,
} from './employee-profile-completeness';

export interface Priority {
  type: 'task' | 'inventory' | 'customer' | 'employee' | 'data_quality';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  related_record_id: string | null;
}

export interface DailyBriefing {
  generated_at: string;
  greeting: string;
  brain_score: {
    total: number;
    change: number | null;
    categories: {
      operations: number;
      employees: number;
      inventory: number;
      customers: number;
      data_quality: number;
    };
  };
  priorities: Priority[];
  positive_updates: string[];
  recommended_actions: string[];
  unavailable_metrics: string[];
}

export class DailyBriefingService {
  constructor(
    private supabase: SupabaseClient,
    private userCompanyId: string,
    private userFullName: string | null
  ) {}

  /**
   * Generate a complete daily briefing for the authenticated user's company
   */
  async generateBriefing(): Promise<DailyBriefing> {
    const now = new Date();
    const greeting = this.generateGreeting(now);
    const unavailableMetrics: string[] = [];

    // 1. Calculate Brain Score
    const scoreService = new BrainScoreService(this.supabase, this.userCompanyId);
    const scoreBreakdown = await scoreService.calculateBrainScore();

    // 2. Collect data for priorities
    const taskSnapshot = await loadTaskSnapshot({ supabase: this.supabase, companyId: this.userCompanyId });
    const overdueTasks = taskSnapshot.rows.filter((task) =>
      isTaskOverdue(task, new Date(taskSnapshot.evaluatedAt), taskSnapshot.companyTimezone));
    const criticalTasks = taskSnapshot.rows.filter((task) =>
      task.priority === 'critical' && task.status === 'pending');
    const [lowStockItems, wasteData, inactiveVIPs, recentComplaints, employeeSnapshot] = await Promise.all([
      this.getLowStockItems(),
      this.getRecentWaste(),
      this.getInactiveVIPCustomers(),
      this.getRecentComplaints(),
      loadActiveEmployeeProfileSnapshot(this.supabase, this.userCompanyId),
    ]);
    const activeEmployees = employeeSnapshot.length;
    const employeesWithMissingData = employeeSnapshot.filter(
      (employee) => !isEmployeeProfileComplete(employee),
    );

    // 3. Build priorities array
    const priorities = this.buildPriorities(
      overdueTasks,
      criticalTasks,
      lowStockItems,
      wasteData,
      inactiveVIPs,
      recentComplaints,
      employeesWithMissingData
    ).slice(0, 5);

    // 4. Build positive updates
    const positiveUpdates = this.buildPositiveUpdates(
      scoreBreakdown,
      overdueTasks,
      activeEmployees,
      inactiveVIPs
    ).slice(0, 3);

    // 5. Build recommended actions
    const recommendedActions = this.buildRecommendedActions(
      overdueTasks,
      criticalTasks,
      lowStockItems,
      inactiveVIPs,
      employeesWithMissingData
    ).slice(0, 3);

    return {
      generated_at: now.toISOString(),
      greeting,
      brain_score: {
        total: scoreBreakdown.total_score,
        change: null, // Could be calculated from brain_score_snapshots if needed
        categories: {
          operations: scoreBreakdown.operations_score,
          employees: scoreBreakdown.employees_score,
          inventory: scoreBreakdown.inventory_score,
          customers: scoreBreakdown.customers_score,
          data_quality: scoreBreakdown.data_quality_score,
        },
      },
      priorities,
      positive_updates: positiveUpdates,
      recommended_actions: recommendedActions,
      unavailable_metrics: unavailableMetrics,
    };
  }

  private generateGreeting(now: Date): string {
    const hours = now.getHours();
    let timeOfDay = 'Good morning';

    if (hours >= 12 && hours < 17) {
      timeOfDay = 'Good afternoon';
    } else if (hours >= 17) {
      timeOfDay = 'Good evening';
    }

    if (this.userFullName) {
      const firstName = this.userFullName.split(' ')[0];
      return `${timeOfDay}, ${firstName}.`;
    }

    return `${timeOfDay}.`;
  }


  private async getLowStockItems(): Promise<any[]> {
    const { data } = await this.supabase
      .from('inventory_items')
      .select('id, name, current_quantity, minimum_quantity, category')
      .eq('company_id', this.userCompanyId)
      .eq('status', 'active')
      .order('current_quantity', { ascending: true });

    // Filter client-side: items where current_quantity < minimum_quantity
    const lowStock = (data || []).filter(
      (item: any) => item.current_quantity < item.minimum_quantity
    );

    return lowStock.slice(0, 10);
  }

  private async getRecentWaste(): Promise<any[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await this.supabase
      .from('inventory_movements')
      .select('id, inventory_item_id, quantity, unit_cost, reason')
      .eq('company_id', this.userCompanyId)
      .eq('movement_type', 'waste')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false });

    return data || [];
  }

  private async getInactiveVIPCustomers(): Promise<any[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await this.supabase
      .from('customers')
      .select('id, first_name, last_name, vip_status, last_visit_at')
      .eq('company_id', this.userCompanyId)
      .neq('vip_status', 'standard')
      .or(`last_visit_at.is.null,last_visit_at.lt.${thirtyDaysAgo}`)
      .limit(10);

    return data || [];
  }

  private async getRecentComplaints(): Promise<any[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await this.supabase
      .from('customer_interactions')
      .select('id, customer_id, interaction_type, description, occurred_at')
      .eq('company_id', this.userCompanyId)
      .eq('interaction_type', 'complaint')
      .gte('occurred_at', sevenDaysAgo)
      .order('occurred_at', { ascending: false });

    return data || [];
  }

  private buildPriorities(
    overdueTasks: TaskMetricRow[],
    criticalTasks: TaskMetricRow[],
    lowStockItems: any[],
    wasteData: any[],
    inactiveVIPs: any[],
    recentComplaints: any[],
    employeesWithMissingData: EmployeeProfileCompletenessRow[]
  ): Priority[] {
    const priorities: Priority[] = [];

    // CRITICAL: Overdue critical tasks
    if (criticalTasks.some((t: any) => {
      return overdueTasks.some((overdue) => overdue.id === t.id);
    })) {
      const overdueCount = criticalTasks.filter((t: any) => {
        return overdueTasks.some((overdue) => overdue.id === t.id);
      }).length;
      priorities.push({
        type: 'task',
        severity: 'critical',
        title: `${overdueCount} critical task${overdueCount > 1 ? 's' : ''} overdue`,
        description: `You have ${overdueCount} overdue critical task${overdueCount > 1 ? 's' : ''} that need immediate attention.`,
        related_record_id: criticalTasks[0]?.id || null,
      });
    }

    // HIGH: General overdue tasks
    if (overdueTasks.length > 0) {
      priorities.push({
        type: 'task',
        severity: 'high',
        title: `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}`,
        description: `${overdueTasks.length} task${overdueTasks.length > 1 ? 's' : ''} past due date.`,
        related_record_id: overdueTasks[0]?.id || null,
      });
    }

    // CRITICAL: Low stock items at zero
    const atZero = lowStockItems.filter((i: any) => i.current_quantity === 0);
    if (atZero.length > 0) {
      priorities.push({
        type: 'inventory',
        severity: 'critical',
        title: `${atZero.length} item${atZero.length > 1 ? 's' : ''} out of stock`,
        description: `${atZero.map((i: any) => i.name).join(', ')} ${atZero.length > 1 ? 'are' : 'is'} completely out of stock.`,
        related_record_id: atZero[0]?.id || null,
      });
    }

    // HIGH: Low stock items (not zero)
    const lowButNotZero = lowStockItems.filter((i: any) => i.current_quantity > 0);
    if (lowButNotZero.length > 0) {
      priorities.push({
        type: 'inventory',
        severity: 'high',
        title: `${lowButNotZero.length} item${lowButNotZero.length > 1 ? 's' : ''} below minimum`,
        description: `${lowButNotZero.length} inventory item${lowButNotZero.length > 1 ? 's' : ''} below minimum quantity.`,
        related_record_id: lowButNotZero[0]?.id || null,
      });
    }

    // HIGH: Recent waste
    if (wasteData.length > 0) {
      const totalWasteValue = wasteData.reduce((sum: number, w: any) => sum + (w.quantity * (w.unit_cost || 0)), 0);
      priorities.push({
        type: 'inventory',
        severity: 'high',
        title: `${wasteData.length} waste record${wasteData.length > 1 ? 's' : ''} in past week`,
        description: `${wasteData.length} waste movement${wasteData.length > 1 ? 's' : ''} recorded totaling $${totalWasteValue.toFixed(2)} value.`,
        related_record_id: null,
      });
    }

    // HIGH: Inactive VIPs
    if (inactiveVIPs.length > 0) {
      priorities.push({
        type: 'customer',
        severity: 'high',
        title: `${inactiveVIPs.length} VIP customer${inactiveVIPs.length > 1 ? 's' : ''} inactive 30+ days`,
        description: `${inactiveVIPs.length} valued customer${inactiveVIPs.length > 1 ? 's' : ''} not visited in over a month.`,
        related_record_id: inactiveVIPs[0]?.id || null,
      });
    }

    // HIGH: Recent complaints
    if (recentComplaints.length > 0) {
      priorities.push({
        type: 'customer',
        severity: 'high',
        title: `${recentComplaints.length} complaint${recentComplaints.length > 1 ? 's' : ''} in past week`,
        description: `${recentComplaints.length} customer complaint${recentComplaints.length > 1 ? 's' : ''} need resolution.`,
        related_record_id: recentComplaints[0]?.id || null,
      });
    }

    // MEDIUM: Employees with missing data
    if (employeesWithMissingData.length > 0) {
      priorities.push({
        type: 'employee',
        severity: 'medium',
        title: `${employeesWithMissingData.length} employee profile${employeesWithMissingData.length > 1 ? 's' : ''} incomplete`,
        description: `${employeesWithMissingData.length} active employee${employeesWithMissingData.length > 1 ? 's are' : ' is'} missing required profile information.`,
        related_record_id: null,
      });
    }

    // Sort by severity: critical > high > medium > low
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    priorities.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return priorities;
  }

  private buildPositiveUpdates(
    scoreBreakdown: any,
    overdueTasks: TaskMetricRow[],
    activeEmployees: number,
    inactiveVIPs: any[]
  ): string[] {
    const updates: string[] = [];

    // Score improving or high
    if (scoreBreakdown.total_score >= 75) {
      updates.push(`Business health is strong at ${scoreBreakdown.total_score}/100.`);
    }

    // No overdue tasks
    if (overdueTasks.length === 0) {
      updates.push('All tasks are on schedule.');
    }

    // Active employees
    if (activeEmployees > 0) {
      updates.push(`${activeEmployees} active team member${activeEmployees > 1 ? 's' : ''} ready to work.`);
    }

    // VIP engagement good
    if (inactiveVIPs.length === 0) {
      updates.push('All VIP customers are actively engaged.');
    }

    // Operations running well
    if (scoreBreakdown.operations_score >= 80) {
      updates.push('Operations running smoothly.');
    }

    return updates;
  }

  private buildRecommendedActions(
    overdueTasks: TaskMetricRow[],
    criticalTasks: TaskMetricRow[],
    lowStockItems: any[],
    inactiveVIPs: any[],
    employeesWithMissingData: EmployeeProfileCompletenessRow[]
  ): string[] {
    const actions: string[] = [];

    // Critical tasks
    const overdueCC = criticalTasks.filter((t: any) => {
      return overdueTasks.some((overdue) => overdue.id === t.id);
    }).length;

    if (overdueCC > 0) {
      actions.push(`Complete the ${overdueCC} overdue critical task${overdueCC > 1 ? 's' : ''}.`);
    }

    // Overdue tasks
    if (overdueTasks.length > 0 && !actions.some(a => a.includes('critical'))) {
      actions.push(`Complete the ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}.`);
    }

    // Low stock
    if (lowStockItems.length > 0) {
      actions.push(`Reorder the ${lowStockItems.length} item${lowStockItems.length > 1 ? 's' : ''} below minimum stock.`);
    }

    // Inactive VIPs
    if (inactiveVIPs.length > 0) {
      actions.push(`Contact the ${inactiveVIPs.length} inactive VIP customer${inactiveVIPs.length > 1 ? 's' : ''} to re-engage.`);
    }

    // Employee data
    if (employeesWithMissingData.length > 0) {
      actions.push(`Update ${employeesWithMissingData.length} employee profile${employeesWithMissingData.length > 1 ? 's' : ''} with missing information.`);
    }

    return actions;
  }
}
