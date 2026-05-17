# Load Test Results

Save human-run staging results as `docs/load_test_results/YYYY-MM-DD.md`.

Use `backend/scripts/chat_load_baseline.py` to generate load, then pull gate metrics from server-side ChatTrace logs and `worker_queue_lag`.

```markdown
## Load Test Results — [date]
Environment: staging
Render config at time of test: [uvicorn workers, RQ workers, concurrency caps]

### Test 1: TTFT Fast Path
Concurrent users: 50 | Duration: 3 min
TTFT p50: Xms | p95: Xms | p99: Xms
Error rate: X%
Result: PASS / FAIL (gate: p95 < 2,500ms)

### Test 2: TTFT Deep Path
Concurrent users: 20 | Duration: 3 min
TTFT p50: Xms | p95: Xms | p99: Xms
Error rate: X%
Result: PASS / FAIL (gate: p95 < 4,000ms)

### Test 3: Mixed-Tenant RLS
DB queries p95: Xms
Cross-tenant observations: NONE OBSERVED / [describe finding]
Result: PASS / FAIL

### Test 4: Queue Recovery
Max lag during load: Xms | Time to recover: Xs
Result: PASS / FAIL

### Test 5: Provider Fallback
Primary disabled: [which provider]
Response rate: X% | TTFT p95 on fallback: Xms
providers_attempted correct in traces: YES / NO
Result: PASS / FAIL

### Launch Gate Summary
[ ] TTFT fast path p95 < 2,500ms
[ ] TTFT deep path p95 < 4,000ms
[ ] DB queries p95 < 200ms
[ ] Queue lag p95 < 30s
[ ] Queue recovers within 60s
[ ] Zero cross-tenant data observations
[ ] 100% response rate on fallback
```
