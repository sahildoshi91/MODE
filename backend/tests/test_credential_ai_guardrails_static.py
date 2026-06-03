from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


AI_CREDENTIAL_DENYLIST = (
    "update_user(",
    "update_user_by_id(",
    "auth.admin.sign_out",
    "auth.sign_out",
    "/api/v1/account/password",
    "/api/v1/account/email",
    "credential_password_change",
    "credential_email_change",
)


AI_SURFACE_FILES = (
    "app/api/v1/chat.py",
    "app/api/v1/chat_sessions.py",
    "app/api/v1/trainer_assistant.py",
    "app/modules/conversation/service.py",
    "app/modules/chat_sessions/service.py",
    "app/modules/trainer_assistant/service.py",
    "app/modules/intelligence_jobs/handlers.py",
    "app/modules/intelligence_jobs/queue.py",
)


def test_ai_surfaces_do_not_call_credential_mutation_paths() -> None:
    for relative_path in AI_SURFACE_FILES:
        source = (ROOT / relative_path).read_text()
        for denied in AI_CREDENTIAL_DENYLIST:
            assert denied not in source, f"{relative_path} must not contain {denied}"


def test_intelligence_job_types_do_not_include_credential_mutations() -> None:
    source = (ROOT / "app/modules/intelligence_jobs/schemas.py").read_text()
    denied_job_tokens = (
        '"password_change"',
        '"email_change"',
        '"credential"',
        '"auth_identity"',
        '"reset_password"',
    )
    for denied in denied_job_tokens:
        assert denied not in source
