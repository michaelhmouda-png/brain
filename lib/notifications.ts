/**
 * Notifications Service
 * Handles notification operations with RLS enforcement
 */

import { SupabaseClient } from '@supabase/supabase-js';

export class NotificationsService {
  constructor(
    private supabase: SupabaseClient,
    private companyId: string
  ) {}

  // ──────────────────────────────────────────────────────────────
  // Notifications
  // ──────────────────────────────────────────────────────────────

  async getNotifications(userId: string, unreadOnly: boolean = false) {
    let query = this.supabase
      .from('notifications')
      .select('*')
      .eq('company_id', this.companyId)
      .eq('recipient_id', userId);

    if (unreadOnly) {
      query = query.eq('is_read', false);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) console.error('[Notifications Service] Get notifications error:', error.message);
    return data || [];
  }

  async createNotification(
    recipientId: string,
    title: string,
    message: string,
    notificationType: string,
    relatedEntityType: string,
    relatedEntityId: string
  ) {
    const { data, error } = await this.supabase
      .from('notifications')
      .insert({
        company_id: this.companyId,
        recipient_id: recipientId,
        title,
        message,
        notification_type: notificationType,
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId,
      })
      .select()
      .single();

    if (error) console.error('[Notifications Service] Create notification error:', error.message);
    return data;
  }

  async markAsRead(notificationId: string) {
    const { data, error } = await this.supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId)
      .eq('company_id', this.companyId)
      .select()
      .single();

    if (error) console.error('[Notifications Service] Mark as read error:', error.message);
    return data;
  }

  async markAllAsRead(userId: string) {
    const { error } = await this.supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('company_id', this.companyId)
      .eq('recipient_id', userId)
      .eq('is_read', false);

    if (error) console.error('[Notifications Service] Mark all as read error:', error.message);
    return !error;
  }

  async deleteNotification(notificationId: string) {
    const { error } = await this.supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('company_id', this.companyId);

    if (error) console.error('[Notifications Service] Delete notification error:', error.message);
    return !error;
  }

  async getUnreadCount(userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', this.companyId)
      .eq('recipient_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('[Notifications Service] Get unread count error:', error.message);
      return 0;
    }

    return count || 0;
  }

  async notifyMultiple(
    recipientIds: string[],
    title: string,
    message: string,
    notificationType: string,
    relatedEntityType: string,
    relatedEntityId: string
  ) {
    const notifications = recipientIds.map(recipientId => ({
      company_id: this.companyId,
      recipient_id: recipientId,
      title,
      message,
      notification_type: notificationType,
      related_entity_type: relatedEntityType,
      related_entity_id: relatedEntityId,
    }));

    const { error } = await this.supabase
      .from('notifications')
      .insert(notifications);

    if (error) console.error('[Notifications Service] Notify multiple error:', error.message);
    return !error;
  }
}
