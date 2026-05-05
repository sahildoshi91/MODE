# Repository Instructions

## Codex Prompt-Close Check

Before sending a final reply after making repo changes, run:

```bash
npm run codex:check
```

If it fails because no backend is reachable, report that clearly instead of saying the task is complete. Start the backend with `npm run backend:dev`, rerun the check, then have the user tap `Retry` in the app.
