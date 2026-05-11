BEGIN;

ALTER TABLE public.trainer_program_templates
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.trainer_program_templates
SET
  metadata = COALESCE(metadata, '{}'::jsonb),
  is_archived = COALESCE(is_archived, FALSE),
  updated_at = COALESCE(updated_at, created_at, NOW())
WHERE TRUE;

CREATE INDEX IF NOT EXISTS idx_trainer_program_templates_active_lookup
  ON public.trainer_program_templates (trainer_id, is_archived, updated_at DESC);

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
  v_program_template JSONB := COALESCE(p_apply_bundle->'program_template', '{}'::jsonb);
  v_program_template_id UUID;
  v_program_template_id_text TEXT;
  v_program_name TEXT;
  v_program_goal_type TEXT;
  v_program_experience_level TEXT;
  v_program_equipment_access TEXT;
  v_program_frequency INTEGER;
  v_program_template_json JSONB := '{}'::jsonb;
  v_program_metadata JSONB := '{}'::jsonb;
  v_program_applied BOOLEAN := FALSE;
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

  IF jsonb_typeof(v_program_template) = 'object' AND v_program_template <> '{}'::jsonb THEN
    v_program_template_id_text := NULLIF(BTRIM(COALESCE(v_program_template->>'template_id', '')), '');
    IF v_program_template_id_text IS NOT NULL THEN
      BEGIN
        v_program_template_id := v_program_template_id_text::UUID;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'Invalid program template id';
      END;
    END IF;

    v_program_name := NULLIF(BTRIM(COALESCE(v_program_template->>'name', '')), '');
    v_program_goal_type := NULLIF(BTRIM(COALESCE(v_program_template->>'goal_type', '')), '');
    v_program_experience_level := NULLIF(BTRIM(COALESCE(v_program_template->>'experience_level', '')), '');
    v_program_equipment_access := NULLIF(BTRIM(COALESCE(v_program_template->>'equipment_access', '')), '');

    IF v_program_template ? 'frequency' THEN
      BEGIN
        IF NULLIF(BTRIM(COALESCE(v_program_template->>'frequency', '')), '') IS NOT NULL THEN
          v_program_frequency := (v_program_template->>'frequency')::INTEGER;
        END IF;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'Invalid program template frequency';
      END;
      IF v_program_frequency IS NOT NULL AND (v_program_frequency < 1 OR v_program_frequency > 14) THEN
        RAISE EXCEPTION 'Program template frequency must be between 1 and 14';
      END IF;
    END IF;

    v_program_template_json := CASE
      WHEN jsonb_typeof(v_program_template->'template_json') = 'object' THEN v_program_template->'template_json'
      ELSE '{}'::jsonb
    END;
    v_program_metadata := CASE
      WHEN jsonb_typeof(v_program_template->'metadata') = 'object' THEN v_program_template->'metadata'
      ELSE '{}'::jsonb
    END;

    IF v_program_template_id IS NULL THEN
      INSERT INTO public.trainer_program_templates (
        trainer_id,
        name,
        goal_type,
        experience_level,
        equipment_access,
        frequency,
        template_json,
        metadata,
        is_archived,
        created_at,
        updated_at
      )
      VALUES (
        v_output.trainer_id,
        COALESCE(v_program_name, 'Program Template'),
        v_program_goal_type,
        v_program_experience_level,
        v_program_equipment_access,
        v_program_frequency,
        v_program_template_json,
        v_program_metadata,
        FALSE,
        v_now,
        v_now
      )
      RETURNING id
      INTO v_program_template_id;
    ELSE
      UPDATE public.trainer_program_templates
      SET
        name = COALESCE(v_program_name, name),
        goal_type = COALESCE(v_program_goal_type, goal_type),
        experience_level = COALESCE(v_program_experience_level, experience_level),
        equipment_access = COALESCE(v_program_equipment_access, equipment_access),
        frequency = COALESCE(v_program_frequency, frequency),
        template_json = CASE
          WHEN v_program_template ? 'template_json' THEN v_program_template_json
          ELSE template_json
        END,
        metadata = CASE
          WHEN v_program_template ? 'metadata' THEN v_program_metadata
          ELSE metadata
        END,
        is_archived = FALSE,
        updated_at = v_now
      WHERE id = v_program_template_id
        AND trainer_id = v_output.trainer_id
      RETURNING id
      INTO v_program_template_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Program template not found';
      END IF;
    END IF;

    v_program_applied := TRUE;
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

  IF v_program_applied THEN
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
      p_idempotency_key || ':program_updated',
      'program_updated',
      'Program template updated',
      'success',
      'system',
      'confirmed',
      jsonb_build_object(
        'output_id', v_output.id,
        'program_template_id', v_program_template_id,
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
    ),
    'program_template', jsonb_build_object(
      'applied', v_program_applied,
      'template_id', v_program_template_id
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
