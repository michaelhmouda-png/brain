-- Read-only production diagnostic. Run as the affected authenticated user.
-- Returns aggregates only; it does not expose task content or mutate data.
WITH actor AS (
  SELECT p.company_id
  FROM public.profiles AS p
  WHERE p.id = auth.uid() AND p.status = 'active'
),
scoped AS (
  SELECT
    t.company_id,
    lower(t.status) AS canonical_status,
    CASE
      WHEN t.due_at IS NOT NULL AND t.due_at < statement_timestamp() THEN 'past_due_at'
      WHEN t.due_at IS NOT NULL THEN 'current_or_future_due_at'
      WHEN t.due_date IS NULL THEN 'no_deadline'
      WHEN t.due_date < (statement_timestamp() AT TIME ZONE c.timezone)::date THEN 'past_date_only'
      WHEN t.due_date = (statement_timestamp() AT TIME ZONE c.timezone)::date THEN 'date_only_today'
      ELSE 'future_date_only'
    END AS deadline_state
  FROM public.tasks AS t
  JOIN actor AS a ON a.company_id = t.company_id
  JOIN public.companies AS c ON c.id = t.company_id
)
SELECT
  'public.tasks'::text AS source_table,
  company_id,
  canonical_status,
  deadline_state,
  count(*) AS row_count,
  count(*) FILTER (
    WHERE canonical_status IN ('pending', 'in_progress')
      AND deadline_state IN ('past_due_at', 'past_date_only')
  ) AS canonical_overdue_count
FROM scoped
GROUP BY company_id, canonical_status, deadline_state
ORDER BY company_id, canonical_status, deadline_state;
