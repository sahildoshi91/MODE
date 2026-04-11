# PHASE 3 - Schema / Domain Model Design

Date: 2026-04-11  
Scope: Trainer platform schema design with strict trainer-global vs client-local separation and backward compatibility.

## 1) Core Design Principles

- Every new trainer-platform table is tenant-scoped (`tenant_id`).
- Trainer-global intelligence and client-local memory are physically separated.
- Existing client-facing tables/contracts remain valid; new tables are additive.
- Every generated artifact and trainer edit is auditable.

## 2) Domain Entity Model

Notes:
- `Existing` means table already exists and should be preserved.
- `New` means additive migration required.
- `Extend` means additive columns/constraints only.

---

### A) Identity + Relationship Layer

#### `trainers` (Existing)
- Purpose: Trainer identity in tenant.
- Key fields: `id`, `tenant_id`, `user_id`, `display_name`, `is_active`, `created_at`.
- Relationships: belongs to `tenants`; has many `clients`, `trainer_personas`, `trainer_knowledge_documents`, `trainer_rules`.
- Indexes: existing tenant/user indexes retained.
- RLS notes: trainer/self visibility and tenant-member visibility.
- Backward compatibility: unchanged schema.
- Migration notes: no breaking changes.

#### `clients` (Extend Existing)
- Purpose: Client identity and current trainer assignment.
- Key fields: existing + `client_name` (already additive).
- Relationships: belongs to `tenants`; assigned to `trainers`; has one `user_fitness_profiles`.
- Indexes: existing indexes retained.
- RLS notes: self + assigned trainer visibility.
- Backward compatibility: preserve `assigned_trainer_id` behavior.
- Migration notes: additive only.

#### `trainer_client_relationships` (Map to Existing `client_trainer_assignments`, Extend)
- Purpose: Assignment history and state transitions.
- Key fields: existing + proposed `status`, `ended_reason`, `ended_by`.
- Relationships: references `clients`, `trainers`.
- Indexes: existing client/trainer indexes; add `(client_id, assigned_at desc)`.
- RLS notes: visible to client self and related trainer.
- Backward compatibility: keep current table and write path.
- Migration notes: additive columns only.

---

### B) Trainer Global Intelligence Layer

#### `trainer_knowledge_documents` (Existing, Extend)
- Purpose: Raw trainer-provided knowledge.
- Key fields: `id`, `trainer_id`, `title`, `raw_text`, `file_url`, `document_type`, `metadata`, `indexing_status`, `created_at`.
- Proposed additive fields: `tenant_id`, `source_type`, `visibility_scope`.
- Relationships: belongs to `trainers`; source for `trainer_rules`/`trainer_rule_versions`.
- Indexes: existing `trainer_id`; add `(trainer_id, created_at desc)`, `(indexing_status)`.
- RLS notes: trainer-owned write/read; optional restricted client-read only for explicitly sharable metadata, not raw internals.
- Backward compatibility: existing API remains valid.
- Migration notes: backfill `tenant_id` via trainer join.

#### `trainer_uploaded_files` (New)
- Purpose: File ingestion metadata and storage linkage.
- Fields: `id`, `tenant_id`, `trainer_id`, `document_id`, `storage_path`, `mime_type`, `size_bytes`, `checksum`, `status`, `created_at`.
- Relationships: optional 1:1 or 1:many to `trainer_knowledge_documents`.
- Indexes: `(trainer_id, created_at desc)`, `(status)`, `(checksum)`.
- RLS notes: trainer-only read/write.
- Backward compatibility: additive.
- Migration notes: no client contract impact.

#### `trainer_rules` (New)
- Purpose: Canonical trainer-global rule records.
- Fields: `id`, `tenant_id`, `trainer_id`, `rule_type`, `status`, `priority`, `current_version_id`, `created_at`, `updated_at`.
- Relationships: one-to-many with `trainer_rule_versions`.
- Indexes: `(trainer_id, rule_type, status)`, `(tenant_id, trainer_id)`.
- RLS notes: trainer-only read/write.
- Backward compatibility: additive.
- Migration notes: seeded from extraction pipeline.

#### `trainer_rule_versions` (New)
- Purpose: Immutable rule history and provenance.
- Fields: `id`, `rule_id`, `version_no`, `normalized_payload`, `source_document_id`, `extraction_job_id`, `created_by_user_id`, `created_at`.
- Relationships: belongs to `trainer_rules`; optional link to knowledge doc + ingestion job.
- Indexes: `(rule_id, version_no desc)`, `(source_document_id)`.
- RLS notes: trainer-only read/write.
- Backward compatibility: additive.
- Migration notes: none required for client.

#### `trainer_personas` (Existing)
- Purpose: Trainer tone/philosophy profile used in conversation.
- Fields: existing table retained.
- Relationships: belongs to `trainers`.
- Indexes: existing `trainer_id`.
- RLS notes: trainer-owned; client read only through existing policies where intended.
- Backward compatibility: preserve existing fields and defaults.
- Migration notes: optional normalization into `trainer_rules` over time without removal.

---

### C) Client Local Memory Layer

#### `client_profiles` (Map to Existing `user_fitness_profiles`)
- Purpose: Core client attributes and baseline goals.
- Fields: existing.
- Relationships: one-to-one with `clients`.
- Indexes: existing `client_id` unique index.
- RLS notes: self + assigned trainer visibility.
- Backward compatibility: preserve existing schema and profile APIs.
- Migration notes: optional additive fields only.

#### `client_notes` (New)
- Purpose: Trainer-authored client memory notes with visibility controls.
- Fields: `id`, `tenant_id`, `trainer_id`, `client_id`, `note_text`, `visibility` (`internal_only|ai_usable`), `tags`, `created_at`, `updated_at`.
- Relationships: belongs to client + trainer.
- Indexes: `(client_id, created_at desc)`, `(client_id, visibility)`, `(trainer_id, created_at desc)`.
- RLS notes: trainer read/write; client read optional for future transparency and only when policy allows.
- Backward compatibility: additive.
- Migration notes: no client API break; new trainer APIs only.

#### `client_preferences` (New)
- Purpose: Structured preferences (schedule, food style, communication style).
- Fields: `id`, `tenant_id`, `client_id`, `preference_key`, `preference_value_json`, `source`, `created_at`, `updated_at`.
- Relationships: belongs to `clients`.
- Indexes: `(client_id, preference_key)`.
- RLS notes: self + assigned trainer.
- Backward compatibility: additive.
- Migration notes: can be partially backfilled from profile fields.

#### `client_constraints` (New)
- Purpose: Structured constraints/contraindications.
- Fields: `id`, `tenant_id`, `client_id`, `constraint_type`, `severity`, `status`, `notes`, `effective_from`, `effective_to`, `created_at`.
- Relationships: belongs to client.
- Indexes: `(client_id, status)`, `(client_id, severity)`.
- RLS notes: self + assigned trainer, trainer write preferred.
- Backward compatibility: additive.
- Migration notes: optional backfill from `injury_notes`.

---

### D) Dynamic Analytics Layer

#### `client_checkins` (Map to Existing `daily_checkins`)
- Purpose: Readiness and daily signal history.
- Fields: existing retained.
- Relationships: belongs to client.
- Indexes: existing `(client_id, date desc)` and mode indexes.
- RLS notes: self + assigned trainer (already exists).
- Backward compatibility: preserve endpoint contracts and mode semantics.
- Migration notes: no breaking changes.

#### `client_workout_logs` (Map to Existing `workouts`)
- Purpose: Completed workout log and intensity feedback.
- Fields: existing + `feel_rating` already additive.
- Relationships: linked to `workout_plans`; implied client via `user_id`.
- Indexes: existing user indexes.
- RLS notes: user-scoped legacy RLS; trainer analytics access through controlled service joins.
- Backward compatibility: preserve current behavior.
- Migration notes: consider additive `client_id` denormalized column later.

#### `client_nutrition_logs` (New)
- Purpose: Nutrition adherence and context signal stream.
- Fields: `id`, `tenant_id`, `client_id`, `log_date`, `payload_json`, `adherence_score`, `created_at`.
- Relationships: belongs to client.
- Indexes: `(client_id, log_date desc)`.
- RLS notes: self + assigned trainer.
- Backward compatibility: additive.
- Migration notes: optional initially, can ship after trainer memory.

#### `analytics_snapshots` (New)
- Purpose: Computed, query-fast periodic metrics.
- Fields: `id`, `tenant_id`, `trainer_id`, `client_id`, `snapshot_date`, `metrics_json`, `created_at`.
- Relationships: belongs to trainer and optionally client.
- Indexes: `(trainer_id, snapshot_date desc)`, `(client_id, snapshot_date desc)`.
- RLS notes: trainer-scoped; client-visible only if explicitly required later.
- Backward compatibility: additive.
- Migration notes: populated by async jobs.

---

### E) Generated Outputs + Feedback Layer

#### `ai_generated_outputs` (New)
- Purpose: Canonical audit table for generated artifacts.
- Fields: `id`, `tenant_id`, `trainer_id`, `client_id`, `output_type`, `source_context_json`, `prompt_fingerprint`, `raw_output_text`, `structured_output_json`, `provider`, `model`, `status`, `created_at`.
- Relationships: references trainer/client; source for feedback events.
- Indexes: `(trainer_id, created_at desc)`, `(client_id, created_at desc)`, `(output_type, created_at desc)`, `(prompt_fingerprint)`.
- RLS notes: trainer-scoped; client visibility only for explicitly client-facing output rows.
- Backward compatibility: additive, with optional dual-write from existing flows.
- Migration notes: start as parallel table to avoid breaking existing generated-plan flow.

#### `ai_feedback_events` (New)
- Purpose: Persist trainer corrections and preference deltas.
- Fields: `id`, `tenant_id`, `trainer_id`, `client_id`, `output_id`, `original_output_ref`, `edited_output_text`, `feedback_tags`, `preference_delta_json`, `created_at`.
- Relationships: belongs to `ai_generated_outputs`.
- Indexes: `(output_id, created_at desc)`, `(trainer_id, created_at desc)`.
- RLS notes: trainer write/read only.
- Backward compatibility: additive.
- Migration notes: no impact on existing client APIs.

#### `talking_points` (New)
- Purpose: Persist command-center talking points by day.
- Fields: `id`, `tenant_id`, `trainer_id`, `client_id`, `target_date`, `points_json`, `confidence_score`, `snapshot_ref`, `created_at`.
- Relationships: trainer/client scoped.
- Indexes: `(trainer_id, target_date desc)`, `(client_id, target_date desc)`.
- RLS notes: trainer-only access.
- Backward compatibility: additive and can coexist with current heuristic in `trainer_home.service`.
- Migration notes: read-through fallback to current computed approach until fully adopted.

#### `ingestion_jobs` (New)
- Purpose: Track extraction/indexing pipeline progress.
- Fields: `id`, `tenant_id`, `trainer_id`, `document_id`, `stage`, `status`, `error_message`, `started_at`, `finished_at`, `created_at`.
- Relationships: links to knowledge docs and rule versions.
- Indexes: `(trainer_id, status, created_at desc)`, `(document_id)`.
- RLS notes: trainer-owned visibility.
- Backward compatibility: additive.
- Migration notes: used by Agent Lab and extraction workflow.

## 3) Trainer-Global vs Client-Local Separation Matrix

### Trainer-Global
- `trainer_personas`
- `trainer_knowledge_documents`
- `trainer_uploaded_files`
- `trainer_rules`
- `trainer_rule_versions`
- `ingestion_jobs`

### Client-Local
- `user_fitness_profiles`
- `client_notes`
- `client_preferences`
- `client_constraints`
- `daily_checkins`
- `workouts`
- `client_nutrition_logs`

### Bridge / Output Layer
- `ai_generated_outputs`
- `ai_feedback_events`
- `talking_points`
- `analytics_snapshots`

## 4) Migration Sequence (Schema Safety)

1. Add new tables + indexes + RLS helper function extensions.
2. Add additive columns to existing tables where required (`tenant_id` on trainer-doc derivatives, etc.).
3. Ship write paths to new tables behind feature flags.
4. Add read-through fallback adapters (new -> old fallback).
5. Introduce optional dual-write from existing generation flows.
6. Validate consistency, then optionally migrate reads fully to new tables.

## 5) Backward Compatibility Notes

- Existing client-facing endpoints remain untouched during initial schema rollout.
- Existing generated plan table remains authoritative until dual-write validation is complete.
- Existing conversation/check-in payload contracts remain unchanged.
- No destructive migration (drop/rename) before regression gates are green.

## Phase 3 Closeout

### Summary
- Schema design now enforces clear separation between trainer-global intelligence and client-local memory.
- Auditability and future evolution are supported through versioned rules and feedback event design.

### Risks
- RLS misconfiguration on new tables.
- Dual-write drift if old/new output tables diverge.
- Over-expansion without strict service boundaries.

### Assumptions
- Additive migrations and feature flags are available.
- Existing client contracts stay stable while new trainer schema is introduced.

### What Will Be Changed Next
- Implement phased rollout plan with concrete milestones, rollback points, and test gates.

### Possible Client-Side Impact
- None in phase 3 (schema design only).
