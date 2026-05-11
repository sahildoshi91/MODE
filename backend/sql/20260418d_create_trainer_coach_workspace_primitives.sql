BEGIN;

ALTER TABLE public.ai_generated_outputs
  ADD COLUMN IF NOT EXISTS priority_tier TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS queue_priority INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS queue_state TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivery_state TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_generated_outputs_priority_tier_check'
      AND conrelid = 'public.ai_generated_outputs'::regclass
  ) THEN
    ALTER TABLE public.ai_generated_outputs
      ADD CONSTRAINT ai_generated_outputs_priority_tier_check
      CHECK (priority_tier IN ('low', 'normal', 'high', 'critical'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_generated_outputs_queue_state_check'
      AND conrelid = 'public.ai_generated_outputs'::regclass
  ) THEN
    ALTER TABLE public.ai_generated_outputs
      ADD CONSTRAINT ai_generated_outputs_queue_state_check
      CHECK (queue_state IN ('pending', 'in_review', 'resolved'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_generated_outputs_delivery_state_check'
      AND conrelid = 'public.ai_generated_outputs'::regclass
  ) THEN
    ALTER TABLE public.ai_generated_outputs
      ADD CONSTRAINT ai_generated_outputs_delivery_state_check
      CHECK (delivery_state IN ('draft', 'sent', 'failed', 'not_applicable'));
  END IF;
END $$;

UPDATE public.ai_generated_outputs
SET
  queue_state = CASE
    WHEN review_status = 'open' THEN 'pending'
    ELSE 'resolved'
  END,
  delivery_state = CASE
    WHEN review_status = 'approved' THEN 'not_applicable'
    ELSE 'draft'
  END,
  last_event_at = COALESCE(last_event_at, reviewed_at, updated_at, created_at)
WHERE TRUE;

CREATE INDEX IF NOT EXISTS idx_ai_generated_outputs_queue_lookup
  ON public.ai_generated_outputs (trainer_id, queue_state, queue_priority DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.trainer_system_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  output_id UUID REFERENCES public.ai_generated_outputs(id) ON DELETE SET NULL,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'error')),
  visibility TEXT NOT NULL DEFAULT 'system' CHECK (visibility IN ('trainer_private', 'system', 'client_public')),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'failed')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_system_events_trainer_event_key
  ON public.trainer_system_events (trainer_id, event_key);
CREATE INDEX IF NOT EXISTS idx_trainer_system_events_trainer_created
  ON public.trainer_system_events (trainer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_system_events_output
  ON public.trainer_system_events (output_id, created_at DESC);

ALTER TABLE public.trainer_system_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_system_events FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.trainer_system_events TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_system_events'
      AND policyname = 'trainer_system_events_select_own'
  ) THEN
    CREATE POLICY trainer_system_events_select_own ON public.trainer_system_events
      FOR SELECT TO authenticated
      USING (public.auth_is_trainer_user(trainer_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_system_events'
      AND policyname = 'trainer_system_events_insert_own'
  ) THEN
    CREATE POLICY trainer_system_events_insert_own ON public.trainer_system_events
      FOR INSERT TO authenticated
      WITH CHECK (public.auth_is_trainer_user(trainer_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_system_events'
      AND policyname = 'trainer_system_events_update_own'
  ) THEN
    CREATE POLICY trainer_system_events_update_own ON public.trainer_system_events
      FOR UPDATE TO authenticated
      USING (public.auth_is_trainer_user(trainer_id))
      WITH CHECK (public.auth_is_trainer_user(trainer_id));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.trainer_mutation_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trainer_id UUID NOT NULL REFERENCES public.trainers(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  output_id UUID REFERENCES public.ai_generated_outputs(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'succeeded' CHECK (status IN ('pending', 'succeeded', 'failed')),
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trainer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_trainer_mutation_operations_trainer_created
  ON public.trainer_mutation_operations (trainer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trainer_mutation_operations_status
  ON public.trainer_mutation_operations (trainer_id, status, updated_at DESC);

ALTER TABLE public.trainer_mutation_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainer_mutation_operations FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.trainer_mutation_operations TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_mutation_operations'
      AND policyname = 'trainer_mutation_operations_select_own'
  ) THEN
    CREATE POLICY trainer_mutation_operations_select_own ON public.trainer_mutation_operations
      FOR SELECT TO authenticated
      USING (public.auth_is_trainer_user(trainer_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_mutation_operations'
      AND policyname = 'trainer_mutation_operations_insert_own'
  ) THEN
    CREATE POLICY trainer_mutation_operations_insert_own ON public.trainer_mutation_operations
      FOR INSERT TO authenticated
      WITH CHECK (public.auth_is_trainer_user(trainer_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'trainer_mutation_operations'
      AND policyname = 'trainer_mutation_operations_update_own'
  ) THEN
    CREATE POLICY trainer_mutation_operations_update_own ON public.trainer_mutation_operations
      FOR UPDATE TO authenticated
      USING (public.auth_is_trainer_user(trainer_id))
      WITH CHECK (public.auth_is_trainer_user(trainer_id));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.trainer_coach_approve_output(
  p_output_id UUID,
  p_idempotency_key TEXT,
  p_edited_output_text TEXT DEFAULT NULL,
  p_edited_output_json JSONB DEFAULT NULL,
  p_apply_bundle JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_output RECORD;
  v_feedback_event RECORD;
  v_system_event RECORD;
  v_existing_response JSONB;
  v_effective_text TEXT;
  v_effective_json JSONB;
  v_delivery JSONB := COALESCE(p_apply_bundle->'delivery', '{}'::jsonb);
  v_delivery_mode TEXT;
  v_message_text TEXT;
  v_conversation_id UUID;
  v_message_id UUID;
  v_memory_delta JSONB;
  v_memory_key TEXT;
  v_memory_text TEXT;
  v_memory_type TEXT;
  v_memory_visibility TEXT;
  v_memory_tags JSONB;
  v_memory_existing_id UUID;
  v_memory_applied_count INTEGER := 0;
  v_events JSONB := '[]'::jsonb;
  v_response JSONB;
BEGIN
  IF p_idempotency_key IS NULL OR BTRIM(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency key is required';
  END IF;

  SELECT *
  INTO v_output
  FROM public.ai_generated_outputs
  WHERE id = p_output_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Output not found';
  END IF;

  IF NOT public.auth_is_trainer_user(v_output.trainer_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT response_payload
  INTO v_existing_response
  FROM public.trainer_mutation_operations
  WHERE trainer_id = v_output.trainer_id
    AND idempotency_key = p_idempotency_key
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_response IS NOT NULL THEN
    RETURN v_existing_response;
  END IF;

  v_effective_text := COALESCE(
    NULLIF(BTRIM(p_edited_output_text), ''),
    v_output.reviewed_output_text,
    v_output.output_text
  );
  v_effective_json := COALESCE(
    p_edited_output_json,
    v_output.reviewed_output_json,
    v_output.output_json,
    '{}'::jsonb
  );

  UPDATE public.ai_generated_outputs
  SET
    review_status = 'approved',
    queue_state = 'resolved',
    reviewed_output_text = v_effective_text,
    reviewed_output_json = v_effective_json,
    reviewed_at = v_now,
    updated_at = v_now,
    last_event_at = v_now
  WHERE id = p_output_id
  RETURNING *
  INTO v_output;

  INSERT INTO public.ai_feedback_events (
    id,
    tenant_id,
    trainer_id,
    client_id,
    output_id,
    event_type,
    original_output_text,
    edited_output_text,
    original_output_json,
    edited_output_json,
    extracted_deltas,
    apply_status,
    metadata
  )
  VALUES (
    gen_random_uuid(),
    v_output.tenant_id,
    v_output.trainer_id,
    v_output.client_id,
    v_output.id,
    'approved',
    v_output.output_text,
    v_effective_text,
    COALESCE(v_output.output_json, '{}'::jsonb),
    COALESCE(v_effective_json, '{}'::jsonb),
    COALESCE(p_apply_bundle->'memory_deltas', '[]'::jsonb),
    'not_applicable',
    jsonb_build_object(
      'source', 'trainer_coach_approve_output',
      'idempotency_key', p_idempotency_key,
      'apply_bundle', COALESCE(p_apply_bundle, '{}'::jsonb)
    )
  )
  RETURNING *
  INTO v_feedback_event;

  IF jsonb_typeof(p_apply_bundle->'memory_deltas') = 'array' AND v_output.client_id IS NOT NULL THEN
    FOR v_memory_delta IN
      SELECT value
      FROM jsonb_array_elements(p_apply_bundle->'memory_deltas')
    LOOP
      v_memory_key := NULLIF(BTRIM(COALESCE(v_memory_delta->>'memory_key', '')), '');
      v_memory_text := NULLIF(BTRIM(COALESCE(v_memory_delta->>'text', '')), '');
      IF v_memory_key IS NULL OR v_memory_text IS NULL THEN
        CONTINUE;
      END IF;

      v_memory_type := LOWER(COALESCE(v_memory_delta->>'memory_type', 'note'));
      IF v_memory_type NOT IN ('note', 'preference', 'constraint') THEN
        v_memory_type := 'note';
      END IF;

      v_memory_visibility := LOWER(COALESCE(v_memory_delta->>'visibility', 'ai_usable'));
      IF v_memory_visibility NOT IN ('internal_only', 'ai_usable') THEN
        v_memory_visibility := 'ai_usable';
      END IF;

      v_memory_tags := CASE
        WHEN jsonb_typeof(v_memory_delta->'tags') = 'array' THEN v_memory_delta->'tags'
        ELSE '[]'::jsonb
      END;

      SELECT id
      INTO v_memory_existing_id
      FROM public.coach_memory
      WHERE trainer_id = v_output.trainer_id
        AND client_id = v_output.client_id
        AND memory_key = v_memory_key
      ORDER BY updated_at DESC
      LIMIT 1;

      IF v_memory_existing_id IS NULL THEN
        INSERT INTO public.coach_memory (
          trainer_id,
          client_id,
          memory_type,
          memory_key,
          value_json,
          updated_at
        )
        VALUES (
          v_output.trainer_id,
          v_output.client_id,
          v_memory_type,
          v_memory_key,
          jsonb_build_object(
            'visibility', v_memory_visibility,
            'is_archived', FALSE,
            'text', v_memory_text,
            'tags', v_memory_tags,
            'structured_data', COALESCE(v_memory_delta->'structured_data', '{}'::jsonb),
            'provenance', jsonb_build_object(
              'source', 'trainer_coach_approve_output',
              'output_id', v_output.id,
              'feedback_event_id', v_feedback_event.id,
              'applied_at', v_now
            )
          ),
          v_now
        );
      ELSE
        UPDATE public.coach_memory
        SET
          memory_type = v_memory_type,
          value_json = jsonb_build_object(
            'visibility', v_memory_visibility,
            'is_archived', FALSE,
            'text', v_memory_text,
            'tags', v_memory_tags,
            'structured_data', COALESCE(v_memory_delta->'structured_data', '{}'::jsonb),
            'provenance', jsonb_build_object(
              'source', 'trainer_coach_approve_output',
              'output_id', v_output.id,
              'feedback_event_id', v_feedback_event.id,
              'applied_at', v_now
            )
          ),
          updated_at = v_now
        WHERE id = v_memory_existing_id;
      END IF;

      v_memory_applied_count := v_memory_applied_count + 1;
    END LOOP;
  END IF;

  v_delivery_mode := LOWER(COALESCE(v_delivery->>'mode', ''));
  IF v_delivery_mode = 'send_client_message' AND v_output.client_id IS NOT NULL THEN
    SELECT id
    INTO v_conversation_id
    FROM public.conversations
    WHERE trainer_id = v_output.trainer_id
      AND client_id = v_output.client_id
      AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 1;

    IF v_conversation_id IS NULL THEN
      INSERT INTO public.conversations (
        trainer_id,
        client_id,
        type,
        status,
        current_stage,
        updated_at
      )
      VALUES (
        v_output.trainer_id,
        v_output.client_id,
        'chat',
        'active',
        'trainer_outbound',
        v_now
      )
      RETURNING id
      INTO v_conversation_id;
    END IF;

    v_message_text := COALESCE(
      NULLIF(BTRIM(v_delivery->>'message_text'), ''),
      NULLIF(BTRIM(v_effective_text), ''),
      'Your coach sent an update.'
    );

    INSERT INTO public.conversation_messages (
      conversation_id,
      role,
      message_text,
      structured_payload
    )
    VALUES (
      v_conversation_id,
      'assistant',
      v_message_text,
      jsonb_build_object(
        'kind', 'client_message_sent',
        'visibility', 'client_public',
        'source', 'trainer_coach_approve_output',
        'output_id', v_output.id
      )
    )
    RETURNING id
    INTO v_message_id;

    UPDATE public.conversations
    SET updated_at = v_now
    WHERE id = v_conversation_id;

    UPDATE public.ai_generated_outputs
    SET
      delivery_state = 'sent',
      conversation_id = v_conversation_id,
      message_id = v_message_id,
      updated_at = v_now,
      last_event_at = v_now
    WHERE id = v_output.id
    RETURNING *
    INTO v_output;
  END IF;

  INSERT INTO public.trainer_system_events (
    tenant_id,
    trainer_id,
    client_id,
    output_id,
    event_key,
    event_type,
    message,
    severity,
    visibility,
    status,
    payload,
    created_at,
    updated_at
  )
  VALUES (
    v_output.tenant_id,
    v_output.trainer_id,
    v_output.client_id,
    v_output.id,
    p_idempotency_key || ':draft_approved',
    'draft_approved',
    'Draft approved',
    'success',
    'system',
    'confirmed',
    jsonb_build_object(
      'output_id', v_output.id,
      'idempotency_key', p_idempotency_key
    ),
    v_now,
    v_now
  )
  RETURNING *
  INTO v_system_event;
  v_events := v_events || jsonb_build_array(to_jsonb(v_system_event));

  IF v_memory_applied_count > 0 THEN
    INSERT INTO public.trainer_system_events (
      tenant_id,
      trainer_id,
      client_id,
      output_id,
      event_key,
      event_type,
      message,
      severity,
      visibility,
      status,
      payload,
      created_at,
      updated_at
    )
    VALUES (
      v_output.tenant_id,
      v_output.trainer_id,
      v_output.client_id,
      v_output.id,
      p_idempotency_key || ':memory_saved',
      'memory_saved',
      'Memory saved',
      'success',
      'system',
      'confirmed',
      jsonb_build_object(
        'output_id', v_output.id,
        'memory_applied_count', v_memory_applied_count,
        'idempotency_key', p_idempotency_key
      ),
      v_now,
      v_now
    )
    RETURNING *
    INTO v_system_event;
    v_events := v_events || jsonb_build_array(to_jsonb(v_system_event));
  END IF;

  IF v_message_id IS NOT NULL THEN
    INSERT INTO public.trainer_system_events (
      tenant_id,
      trainer_id,
      client_id,
      output_id,
      event_key,
      event_type,
      message,
      severity,
      visibility,
      status,
      payload,
      created_at,
      updated_at
    )
    VALUES (
      v_output.tenant_id,
      v_output.trainer_id,
      v_output.client_id,
      v_output.id,
      p_idempotency_key || ':client_message_sent',
      'client_message_sent',
      'Client message sent',
      'success',
      'client_public',
      'confirmed',
      jsonb_build_object(
        'output_id', v_output.id,
        'conversation_id', v_conversation_id,
        'message_id', v_message_id,
        'idempotency_key', p_idempotency_key
      ),
      v_now,
      v_now
    )
    RETURNING *
    INTO v_system_event;
    v_events := v_events || jsonb_build_array(to_jsonb(v_system_event));
  END IF;

  v_response := jsonb_build_object(
    'output', to_jsonb(v_output),
    'feedback_event', to_jsonb(v_feedback_event),
    'events', v_events,
    'memory_applied_count', v_memory_applied_count,
    'delivery', jsonb_build_object(
      'mode', CASE WHEN v_message_id IS NULL THEN 'draft_only' ELSE 'sent' END,
      'conversation_id', v_conversation_id,
      'message_id', v_message_id
    )
  );

  INSERT INTO public.trainer_mutation_operations (
    tenant_id,
    trainer_id,
    client_id,
    output_id,
    idempotency_key,
    operation_type,
    status,
    request_payload,
    response_payload,
    error_payload,
    created_at,
    updated_at
  )
  VALUES (
    v_output.tenant_id,
    v_output.trainer_id,
    v_output.client_id,
    v_output.id,
    p_idempotency_key,
    'approve_output_bundle',
    'succeeded',
    jsonb_build_object(
      'output_id', p_output_id,
      'edited_output_text', p_edited_output_text,
      'edited_output_json', p_edited_output_json,
      'apply_bundle', COALESCE(p_apply_bundle, '{}'::jsonb)
    ),
    v_response,
    '{}'::jsonb,
    v_now,
    v_now
  )
  ON CONFLICT (trainer_id, idempotency_key)
  DO NOTHING;

  RETURN v_response;
END;
$$;

GRANT EXECUTE ON FUNCTION public.trainer_coach_approve_output(UUID, TEXT, TEXT, JSONB, JSONB) TO authenticated;

COMMIT;
