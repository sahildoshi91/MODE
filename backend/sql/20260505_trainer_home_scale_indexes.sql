BEGIN;

CREATE INDEX IF NOT EXISTS idx_clients_trainer_tenant_created
  ON public.clients (assigned_trainer_id, tenant_id, created_at DESC)
  WHERE assigned_trainer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workouts_completed_user_created
  ON public.workouts (user_id, created_at DESC)
  WHERE completed = TRUE;

COMMIT;
