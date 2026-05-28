WITH ranked_active_events AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS rank_order
  FROM events
  WHERE status <> 'completed'
)
UPDATE events
SET status = 'completed',
    updated_at = NOW()
WHERE id IN (
  SELECT id
  FROM ranked_active_events
  WHERE rank_order > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS events_single_active_event_idx
  ON events ((status <> 'completed'))
  WHERE status <> 'completed';
