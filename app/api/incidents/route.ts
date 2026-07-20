/**
 * Incidents API
 * GET /api/incidents - List incidents with pagination, search, filtering
 * POST /api/incidents - Create incident
 */

import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { IncidentsService } from '@/lib/incidents';
import { ActivityTimelineService } from '@/lib/activity-timeline';
import { NotificationsService } from '@/lib/notifications';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { canCreateIncident, parseIncidentCreationRequest } from '@/lib/incident-report';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie, Authorization',
};

export async function GET(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerAuth();
    const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
    if (!authorization.authorized) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'No company found' },
        { status: authorization.status, headers: NO_STORE_HEADERS }
      );
    }

    const incidentsService = new IncidentsService(supabase, authorization.companyId);

    const url = new URL(req.url);
    
    // Extract query parameters
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
    const search = url.searchParams.get('search') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const severity = url.searchParams.get('severity') || undefined;
    const incidentType = url.searchParams.get('incidentType') || undefined;
    const sortBy = url.searchParams.get('sortBy') || 'incident_time';
    const sortOrder = (url.searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';
    const dateFrom = url.searchParams.get('dateFrom') || undefined;
    const dateTo = url.searchParams.get('dateTo') || undefined;
    const critical = url.searchParams.get('critical');

    // Handle critical incidents special case
    if (critical === 'true') {
      const incidents = await incidentsService.getCriticalIncidents();
      return NextResponse.json({ data: incidents, total: incidents.length }, { headers: NO_STORE_HEADERS });
    }

    // List with full pagination, search, and filtering
    const result = await incidentsService.listIncidents({
      page,
      pageSize,
      search,
      status,
      severity,
      incidentType,
      sortBy: sortBy as 'incident_time' | 'severity' | 'status' | 'created_at',
      sortOrder,
      dateFrom,
      dateTo,
    });

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('[Incidents API] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerAuth();
    const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
    if (!authorization.authorized) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'No company found' },
        { status: authorization.status, headers: NO_STORE_HEADERS },
      );
    }
    if (!canCreateIncident(authorization.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403, headers: NO_STORE_HEADERS });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const data = parseIncidentCreationRequest(body);
    if (!data) return NextResponse.json({ error: 'Invalid incident data' }, { status: 400, headers: NO_STORE_HEADERS });

    if (data.locationId) {
      const { data: location, error: locationError } = await supabase
        .from('locations')
        .select('id')
        .eq('id', data.locationId)
        .eq('company_id', authorization.companyId)
        .maybeSingle();
      if (locationError || !location) {
        return NextResponse.json({ error: 'Invalid location' }, { status: 400, headers: NO_STORE_HEADERS });
      }
    }

    const incidentsService = new IncidentsService(supabase, authorization.companyId);
    const timelineService = new ActivityTimelineService(supabase, authorization.companyId);
    const notificationService = new NotificationsService(supabase, authorization.companyId);

    const incident = await incidentsService.createIncident(
      data.title,
      data.description,
      data.incidentType,
      data.severity,
      data.locationId,
      data.affectedArea,
      data.incidentTime,
      authorization.profileId
    );

    await timelineService.logActivity(
      authorization.profileId,
      'incident_reported',
      'incident_report',
      incident.id,
      data.title
    );

    // Notify managers if critical
    if (data.severity === 'critical') {
      const { data: managers } = await supabase
        .from('profiles')
        .select('id')
        .eq('company_id', authorization.companyId)
        .eq('role', 'manager');

      if (managers) {
        const managerIds = managers
          .map((manager) => manager.id)
          .filter((id): id is string => typeof id === 'string');
        await notificationService.notifyMultiple(
          managerIds,
          'CRITICAL Incident Report',
          data.title,
          'incident',
          'incident_report',
          incident.id
        );
      }
    }

    return NextResponse.json(incident, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('[Incidents API] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerAuth();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('user_id', user.id)
      .single();

    if (!profile?.company_id) {
      return NextResponse.json({ error: 'No company found' }, { status: 403 });
    }

    const incidentsService = new IncidentsService(supabase, profile.company_id);
    const timelineService = new ActivityTimelineService(supabase, profile.company_id);

    const body = await req.json();
    const { action, data } = body;

    if (action === 'update_status') {
      const incident = await incidentsService.updateIncidentStatus(
        data.incidentId,
        data.status
      );

      await timelineService.logActivity(
        user.id,
        'incident_updated',
        'incident_report',
        incident.id,
        `Status changed to ${data.status}`
      );

      return NextResponse.json(incident);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[Incidents API] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
