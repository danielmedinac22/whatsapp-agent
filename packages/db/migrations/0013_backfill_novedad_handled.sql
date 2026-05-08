-- Seal off the existing novedad backlog so the new automation does not
-- spam customers whose cases were already resolved manually before deploy.
-- Sets first_notified + escalated to now() for every current novedad row,
-- which makes the worker treat them as already-handed-off (skipped by both
-- the initial outreach guard and the reminder cron's IS NULL filters).
UPDATE "dropi_orders"
SET
  "novedad_first_notified_at" = COALESCE("novedad_first_notified_at", now()),
  "novedad_escalated_at"      = COALESCE("novedad_escalated_at", now()),
  "updated_at"                = now()
WHERE "status" = 'novedad';
