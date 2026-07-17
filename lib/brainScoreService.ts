import type { SupabaseClient } from '@supabase/supabase-js';

export interface BrainScoreMetrics {
  tasks?: {
    completionRate: number;
    overdueCount: number;
    overduePercentage: number;
    totalTasks: number;
  };
  employees?: {
    activeCount: number;
    inactiveCount: number;
    totalCount: number;
    inactivePercentage: number;
    missingProfileData: number;
  };
  inventory?: {
    lowStockCount: number;
    lowStockPercentage: number;
    wasteRate: number;
    totalValue: number;
    missingCostData: number;
  };
  customers?: {
    repeatCustomerRate: number;
    inactiveVIPCount: number;
    complaintRate: number;
    noShowRate: number;
    averageLifetimeValue: number;
  };
  dataQuality?: {
    missingEmployeeData: number;
    incompleteRecords: number;
  };
}

export interface BrainScoreBreakdown {
  total_score: number;
  operations_score: number;
  employees_score: number;
  inventory_score: number;
  customers_score: number;
  data_quality_score: number;
  metrics: BrainScoreMetrics;
  top_issues: string[];
  recommended_actions: string[];
}

export class BrainScoreService {
  constructor(
    private supabase: SupabaseClient,
    private userCompanyId: string
  ) {}

  /**
   * Calculate comprehensive Brain Score (0-100)
   * Weighted categories:
   * - Tasks/Operations: 25%
   * - Employees/Staffing: 20%
   * - Inventory: 20%
   * - Customers: 20%
   * - Data Quality: 15%
   */
  async calculateBrainScore(): Promise<BrainScoreBreakdown> {
    const metrics: BrainScoreMetrics = {};

    // Calculate each category score
    const operationsScore = await this.calculateOperationsScore(metrics);
    const employeesScore = await this.calculateEmployeesScore(metrics);
    const inventoryScore = await this.calculateInventoryScore(metrics);
    const customersScore = await this.calculateCustomersScore(metrics);
    const dataQualityScore = await this.calculateDataQualityScore(metrics);

    // Calculate weighted total
    const totalScore =
      operationsScore * 0.25 +
      employeesScore * 0.2 +
      inventoryScore * 0.2 +
      customersScore * 0.2 +
      dataQualityScore * 0.15;

    // Generate issues and recommendations
    const { topIssues, recommendedActions } = this.generateIssuesAndRecommendations(
      metrics,
      { operationsScore, employeesScore, inventoryScore, customersScore, dataQualityScore }
    );

    return {
      total_score: Math.round(totalScore),
      operations_score: Math.round(operationsScore),
      employees_score: Math.round(employeesScore),
      inventory_score: Math.round(inventoryScore),
      customers_score: Math.round(customersScore),
      data_quality_score: Math.round(dataQualityScore),
      metrics,
      top_issues: topIssues,
      recommended_actions: recommendedActions,
    };
  }

  private async calculateOperationsScore(metrics: BrainScoreMetrics): Promise<number> {
    const { data: tasks } = await this.supabase
      .from('tasks')
      .select('id, status, priority, due_date')
      .eq('company_id', this.userCompanyId);

    if (!tasks || tasks.length === 0) {
      return 100; // No tasks = no operational issues
    }

    const today = new Date().toISOString().split('T')[0];
    const completed = tasks.filter((t: any) => t.status === 'Completed').length;
    const completionRate = (completed / tasks.length) * 100;

    const overdue = tasks.filter(
      (t: any) => t.status !== 'Completed' && t.due_date && t.due_date < today
    ).length;

    const criticalOverdue = tasks.filter(
      (t: any) => t.priority === 'Critical' && t.status !== 'Completed' && t.due_date && t.due_date < today
    ).length;

    metrics.tasks = {
      completionRate: Math.round(completionRate),
      overdueCount: overdue,
      overduePercentage: Math.round((overdue / tasks.length) * 100),
      totalTasks: tasks.length,
    };

    // Score formula: completion rate (50%), no critical overdue (50%)
    let score = completionRate * 0.5;
    score += Math.max(0, (50 - criticalOverdue * 10)); // Deduct 10 points per critical overdue task

    return Math.min(100, Math.max(0, score));
  }

  private async calculateEmployeesScore(metrics: BrainScoreMetrics): Promise<number> {
    const { data: employees } = await this.supabase
      .from('employees')
      .select('id, status, email, phone, role')
      .eq('company_id', this.userCompanyId);

    if (!employees || employees.length === 0) {
      return 100; // No employees tracked yet
    }

    const active = employees.filter((e: any) => e.status === 'active').length;
    const inactive = employees.length - active;
    const missingData = employees.filter(
      (e: any) => !e.email || !e.phone || !e.role
    ).length;

    metrics.employees = {
      activeCount: active,
      inactiveCount: inactive,
      totalCount: employees.length,
      inactivePercentage: Math.round((inactive / employees.length) * 100),
      missingProfileData: missingData,
    };

    // Score: active coverage (70%), no missing data (30%)
    let score = (active / employees.length) * 70;
    const dataScore = Math.max(0, 30 - missingData * 3);
    score += dataScore;

    return Math.min(100, Math.max(0, score));
  }

  private async calculateInventoryScore(metrics: BrainScoreMetrics): Promise<number> {
    const { data: items } = await this.supabase
      .from('inventory_items')
      .select('id, current_quantity, minimum_quantity, unit_cost, status')
      .eq('company_id', this.userCompanyId);

    if (!items || items.length === 0) {
      return 100; // No inventory tracked yet
    }

    const lowStock = items.filter((i: any) => i.current_quantity < i.minimum_quantity).length;
    const totalValue = items.reduce((sum: number, i: any) => sum + (i.current_quantity * (i.unit_cost || 0)), 0);
    const missingCost = items.filter((i: any) => !i.unit_cost).length;

    // Get waste data
    const { data: waste } = await this.supabase
      .from('inventory_movements')
      .select('quantity, unit_cost')
      .eq('company_id', this.userCompanyId)
      .eq('movement_type', 'waste');

    const wasteValue = (waste || []).reduce((sum: number, w: any) => sum + (w.quantity * (w.unit_cost || 0)), 0);

    metrics.inventory = {
      lowStockCount: lowStock,
      lowStockPercentage: Math.round((lowStock / items.length) * 100),
      wasteRate: totalValue > 0 ? Math.round((wasteValue / totalValue) * 100) : 0,
      totalValue: Math.round(totalValue),
      missingCostData: missingCost,
    };

    // Score: no low stock (60%), low waste (30%), complete data (10%)
    let score = Math.max(0, 60 - (lowStock * 5));
    score += Math.max(0, 30 - metrics.inventory.wasteRate);
    score += Math.max(0, 10 - missingCost * 2);

    return Math.min(100, Math.max(0, score));
  }

  private async calculateCustomersScore(metrics: BrainScoreMetrics): Promise<number> {
    const { data: customers } = await this.supabase
      .from('customers')
      .select('id, total_visits, total_spend, vip_status, last_visit_at')
      .eq('company_id', this.userCompanyId);

    if (!customers || customers.length === 0) {
      return 100; // No customers tracked yet
    }

    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    const repeatCustomers = customers.filter((c: any) => c.total_visits > 1).length;
    const repeatRate = (repeatCustomers / customers.length) * 100;

    const inactiveVIPs = customers.filter(
      (c: any) => c.vip_status !== 'standard' && (!c.last_visit_at || new Date(c.last_visit_at) < thirtyDaysAgo)
    ).length;

    // Get complaint/no-show data
    const { data: interactions } = await this.supabase
      .from('customer_interactions')
      .select('interaction_type')
      .eq('company_id', this.userCompanyId);

    const complaints = (interactions || []).filter((i: any) => i.interaction_type === 'complaint').length;
    const noShows = (interactions || []).filter((i: any) => i.interaction_type === 'no_show').length;
    const complaintRate = interactions && interactions.length > 0 
      ? Math.round((complaints / interactions.length) * 100)
      : 0;

    const avgLifetimeValue = customers.length > 0
      ? Math.round(customers.reduce((sum: number, c: any) => sum + (c.total_spend || 0), 0) / customers.length)
      : 0;

    metrics.customers = {
      repeatCustomerRate: Math.round(repeatRate),
      inactiveVIPCount: inactiveVIPs,
      complaintRate,
      noShowRate: interactions && interactions.length > 0
        ? Math.round((noShows / interactions.length) * 100)
        : 0,
      averageLifetimeValue: avgLifetimeValue,
    };

    // Score: repeat rate (40%), no inactive VIPs (40%), low complaints (20%)
    let score = repeatRate * 0.4;
    score += Math.max(0, (40 - inactiveVIPs * 5));
    score += Math.max(0, 20 - metrics.customers.complaintRate);

    return Math.min(100, Math.max(0, score));
  }

  private async calculateDataQualityScore(metrics: BrainScoreMetrics): Promise<number> {
    let missingFields = 0;

    // Check employee data quality
    const { data: employees } = await this.supabase
      .from('employees')
      .select('id, email, phone')
      .eq('company_id', this.userCompanyId);

    const employeeMissing = (employees || []).filter((e: any) => !e.email || !e.phone).length;
    missingFields += employeeMissing;

    // Check inventory data quality
    const { data: inventory } = await this.supabase
      .from('inventory_items')
      .select('id, unit_cost, minimum_quantity')
      .eq('company_id', this.userCompanyId);

    const inventoryMissing = (inventory || []).filter((i: any) => !i.unit_cost || !i.minimum_quantity).length;
    missingFields += inventoryMissing;

    metrics.dataQuality = {
      missingEmployeeData: employeeMissing,
      incompleteRecords: inventoryMissing,
    };

    // Score: deduct 2 points per missing field, cap at 100
    const score = Math.max(0, 100 - missingFields * 2);
    return Math.min(100, score);
  }

  private generateIssuesAndRecommendations(
    metrics: BrainScoreMetrics,
    scores: {
      operationsScore: number;
      employeesScore: number;
      inventoryScore: number;
      customersScore: number;
      dataQualityScore: number;
    }
  ): { topIssues: string[]; recommendedActions: string[] } {
    const issues: string[] = [];
    const actions: string[] = [];

    // Identify top issues
    if (metrics.tasks && metrics.tasks.overduePercentage > 0) {
      issues.push(`${metrics.tasks.overduePercentage}% of tasks are overdue`);
    }

    if (metrics.inventory && metrics.inventory.lowStockPercentage > 0) {
      issues.push(`${metrics.inventory.lowStockPercentage}% of inventory items are below minimum stock`);
    }

    if (metrics.inventory && metrics.inventory.wasteRate > 5) {
      issues.push(`Inventory waste rate is ${metrics.inventory.wasteRate}%`);
    }

    if (metrics.customers && metrics.customers.inactiveVIPCount > 0) {
      issues.push(`${metrics.customers.inactiveVIPCount} VIP customers have not visited in 30 days`);
    }

    if (metrics.employees && metrics.employees.inactivePercentage > 10) {
      issues.push(`${metrics.employees.inactivePercentage}% of employees are marked inactive`);
    }

    // Generate top 3 recommended actions
    if (metrics.inventory && metrics.inventory.lowStockPercentage > 0) {
      actions.push('Reorder the lowest-stock inventory items to prevent stockouts');
    }

    if (metrics.tasks && metrics.tasks.overdueCount > 0) {
      actions.push(`Complete the ${metrics.tasks.overdueCount} overdue tasks`);
    }

    if (metrics.customers && metrics.customers.inactiveVIPCount > 0) {
      actions.push(`Contact ${metrics.customers.inactiveVIPCount} inactive VIP customers to re-engage them`);
    }

    if (metrics.dataQuality && metrics.dataQuality.missingEmployeeData > 0) {
      actions.push(`Update ${metrics.dataQuality.missingEmployeeData} incomplete employee profiles`);
    }

    return {
      topIssues: issues.slice(0, 3),
      recommendedActions: actions.slice(0, 3),
    };
  }
}
