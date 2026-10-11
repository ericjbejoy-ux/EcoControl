# CarbonTwin ML & Digital Twin Service (`services/ml`)

Owner: **Member 1 — AI/ML & Digital Twin Engineer**. Python 3.11 + FastAPI.

This service is the scientific core of CarbonTwin. It is stateless over HTTP:
every endpoint accepts the series it needs in the request body, so it scales
horizontally and works with cached/offline data (NFR-2, NFR-3).

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/ml/train` | Train/refresh the quantile load forecaster for a facility |
| GET | `/ml/model-card/{facility_id}` | Metrics, features, training window, notes |
| GET | `/ml/models` | List persisted models + active backend |
| POST | `/ml/forecast` | 96-step (24 h) quantile forecast + emissions band |
| POST | `/ml/explain` | SHAP global importance + local waterfall + NLG sentence |
| POST | `/twin/simulate` | RC thermal twin simulation (RK45) |
| POST | `/twin/calibrate` | Fit R, C, window factor from history |
| POST | `/optimize` | Carbon-aware MPC HVAC schedule |
| POST | `/scenario/evaluate` | Stack levers → KPIs + series |
| GET/POST | `/scenario/macc` | Marginal abatement cost curve dataset |
| POST | `/anomaly/detect` | Waste/anomaly flags with est. wasted kgCO₂e |
| GET | `/health` | Liveness + dependency status |

Interactive OpenAPI docs at `/docs`.

## Run

```bash
# from services/ml
python -m venv .venv && . .venv/Scripts/activate   # Windows PowerShell
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Docker (from repo root): `docker compose up ml`.

## Design notes

- **Graceful degradation.** `lightgbm` and `shap` are the only heavy deps; if
  they are missing, the forecaster falls back to `sklearn` gradient boosting
  (quantile loss) and the explainer to an importance-scaled approximation. The
  service still boots and returns valid payloads (`/health` reports `degraded`).
- **Mocks first.** `app/mock/mock_responses.py` returns contract-valid payloads
  so M3/M4 are unblocked on Day 3. Toggle with `ML_USE_MOCKS=true`.
- **Contract.** `app/schemas.py` (pydantic) and
  `packages/shared/src/ml.schemas.ts` (zod) are kept in lock-step.
- **Physics.** The RC twin has both an RK45 integrator (`solve_ivp`) and an exact
  piecewise-constant integrator; tests assert they agree to <1e-4 °C.

See `docs/methodology.md` and `docs/model-card.md`.

## Test

```bash
pytest -q
```
