BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_name TEXT;

UPDATE public.clients c
SET client_name = split_part(u.email, '@', 1)
FROM auth.users u
WHERE c.user_id = u.id
  AND (c.client_name IS NULL OR btrim(c.client_name) = '')
  AND u.email IS NOT NULL;

CREATE OR REPLACE FUNCTION public.populate_client_name_from_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.client_name IS NULL OR btrim(NEW.client_name) = '' THEN
    SELECT split_part(u.email, '@', 1)
    INTO NEW.client_name
    FROM auth.users u
    WHERE u.id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clients_populate_name ON public.clients;
CREATE TRIGGER trg_clients_populate_name
BEFORE INSERT OR UPDATE OF user_id, client_name
ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.populate_client_name_from_email();

CREATE TABLE IF NOT EXISTS public.trainer_daily_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  session_start_at TIMESTAMPTZ,
  session_end_at TIMESTAMPTZ,
  session_type TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.trainer_daily_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_daily_schedule FORCE ROW LEVEL SECURITY;

GRANT SELECT ON public.trainer_daily_schedule TO authenticated;

CREATE INDEX IF NOT EXISTS idx_trainer_daily_schedule_trainer_date
  ON public.trainer_daily_schedule (trainer_id, session_date);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_daily_schedule'
      AND policyname = 'trainer_daily_schedule_select_visible'
  ) THEN
    CREATE POLICY trainer_daily_schedule_select_visible ON public.trainer_daily_schedule
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.trainers t
          WHERE t.id = trainer_daily_schedule.trainer_id
            AND t.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.clients c
          WHERE c.id = trainer_daily_schedule.client_id
            AND c.user_id = auth.uid()
        )
      );
  END IF;
END $$;

COMMIT;
