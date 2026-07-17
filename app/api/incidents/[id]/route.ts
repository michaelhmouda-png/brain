/**
 * Incidents API - Get/Update/Archive by ID
 * GET /api/incidents/:id - Get incident by ID
 * PUT /api/incidents/:id - Update incident
 * DELETE /api/incidents/:id - Archive incident (soft delete)
 */

import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { IncidentsService } from '@/lib/incidents';
import { ActivityTimelineService } from '@/lib/activity-timeline';
import { NextRequest, NextResponse } from 'next/server';

async function getCompanyId(supabase: any, user: any) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('user_id', user.id)
    .single();
  return profile?.company_id;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerAuth();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const companyId = await getCompanyId(supabase, user);
    if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 403 });

    const incidentsService = new IncidentsService(supabase, companyId);
    const incident = await incidentsService.getIncidentById(id);

    if (!incident) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }

    return NextResponse.json(incident);
  } catch (error) {
    console.error('[Incidents API] GET by ID error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerAuth();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const companyId = await getCompanyId(supabase, user);
    if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 403 });

    const incidentsService = new IncidentsService(supabase, companyId);
    const timelineService = new ActivityTimelineService(supabase, companyId);

    const body = await req.json();
    const { title, description, incidentType, severity, locationId, affectedArea, incidentTime, status } = body;

    const updates: any = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (incidentType !== undefined) updates.incident_type = incidentType;
    if (severity !== undefined) updates.severity = severity;
    if (locationId !== undefined) updates.location_id = locationId;
    if (affectedArea !== undefined) updates.affected_area = affectedArea;
    if (incidentTime !== undefined) updates.incident_time = incidentTime;
    if (status !== undefined) updates.status = status;

    const incident = await incidentsService.updateIncident(id, updates);

    if (incident) {
      await timelineService.logActivity(
        user.id,
        'incident_report_updated',
        'incident_report',
        incident.id,
        `Incident updated: ${title || 'No title change'}`
      );
    }

    return NextResponse.json(incident);
  } catch (error) {
    console.error('[Incidents API] PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServerAuth();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const companyId = await getCompanyId(supabase, user);
    if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 403 });

    const incidentsService = new IncidentsService(supabase, companyId);
    const timelineService = new ActivityTimelineService(supabase, companyId);

    const incident = await incidentsService.archiveIncident(id);

    if (incident) {
      await timelineService.logActivity(
        user.id,
        'incident_report_archived',
        'incident_report',
        id,
        'Incident archived'
      );
      return NextResponse.json({ success: true, message: 'Incident archived', data: incident });
    }

    return NextResponse.json({ error: 'Failed to archive incident' }, { status: 400 });
  } catch (error) {
    console.error('[Incidents API] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
