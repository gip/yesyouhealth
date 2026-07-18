# deid-service — FHIR de-identification microservice

Scrubs identified FHIR R4 data (a Bundle or single resource) into a Safe
Harbor-style de-identified record with **realistic replacement values**, so the
output stays usable for downstream training. Designed to run inside a Phala
confidential VM (dstack TEE) but fully functional locally with plain Docker.

**Synthetic / sandbox data only. Never point real PHI at a hackathon service.**

## Engines

De-identification is **LLM-first with a rule-based fallback**:

- **LLM engine** (default): an Ollama sidecar runs `qwen3:30b`; the whole
  resource/Bundle is scrubbed by the model. At service startup the model is
  pulled (if missing) and warmed into memory; until it is ready — or whenever
  Ollama is down, a request times out, or the model returns invalid output —
  requests transparently fall back to the rules engine.
- **Rules engine**: the original deterministic scrubber (Faker surrogates +
  optional Presidio free-text pass). Always available; set `DEID_ENGINE=rules`
  to use it exclusively.

Every LLM result is validated before it is returned: the structure must match
the input (same resourceType, same Bundle entries) and **no identifying value
from the input's structured fields (names, telecom, identifiers, addresses,
birthDate) may survive verbatim** — any violation falls back to the rules
engine. The model runs in thinking mode (required for reliable recall), so
LLM-path requests take minutes on CPU.

Every `/scrub` response carries an `X-Deid-Engine: llm|rules` header saying
which engine actually produced it. Note the LLM engine is **not deterministic
and its free-text PHI recall is not guaranteed** the way the rules engine is.

## Endpoints

| Endpoint | Description |
| --- | --- |
| `POST /scrub` | Body is FHIR JSON; returns scrubbed JSON with identical shape (`X-Deid-Engine` header says which engine ran) |
| `GET /health` | Liveness (never depends on Ollama) + LLM status: `{"status": "ok", "llm": {"state": "starting\|pulling\|warming\|ready\|unavailable\|disabled", ...}}` |
| `GET /attestation` | dstack RA quote inside a TEE; `{"tee": false}` otherwise |

## Configuration (env vars)

| Var | Default | Meaning |
| --- | --- | --- |
| `DEID_ENGINE` | `llm` | `llm`: qwen3-first with rules fallback. `rules`: rule-based engine only, no Ollama contact |
| `OLLAMA_HOST` | `http://ollama:11434` | Base URL of the Ollama server |
| `OLLAMA_MODEL` | `qwen3:30b` | Model tag to pull/load/use (code is model-agnostic) |
| `OLLAMA_TIMEOUT` | `300` | Per-request generate timeout (seconds); on timeout the request falls back to rules. The model runs in thinking mode, so CPU inference takes minutes |
| `OLLAMA_KEEP_ALIVE` | `60m` | How long Ollama keeps the model in memory after a request |
| `OLLAMA_NUM_CTX` | `16384` | Model context window; resources too large for it fall back to rules |
| `AGE_STRATEGY` | `fixed_30` | (rules engine) `fixed_30`: synthetic DOB ~30y old ±3y. `preserve_band`: real age generalized to a 5-year band midpoint |
| `SCRUB_FREETEXT` | `false` | (rules engine) Run Presidio (spaCy `en_core_web_sm`) over free-text fields for PERSON / DATE_TIME / PHONE_NUMBER / EMAIL_ADDRESS / LOCATION |
| `RETURN_MAP` | `false` | Also return the per-request original→surrogate map (de-id is one-way by default). The LLM engine cannot produce a map, so it returns `"map": null` |

Consistency guarantee (rules engine): within one request, the same original
value always maps to the same fake value (deterministically seeded from a hash
of the original), so cross-resource references, repeated names, and inline
mentions in free text stay coherent. All other dates get one consistent
per-patient date-shift (±0–180 days) so event intervals are preserved. The LLM
engine is prompted to uphold the same properties but cannot guarantee them.

## 1. Run locally

```bash
docker compose -f docker-compose.local.yml up
```

First boot downloads `qwen3:30b` (~18GB) into the `ollama-models` volume;
watch `GET /health` progress through `starting → pulling → warming → ready`.
Until then `/scrub` answers via the rules engine (`X-Deid-Engine: rules`).

Then scrub the sample bundle:

```bash
curl -s -X POST http://localhost:8000/scrub \
  -H 'Content-Type: application/json' \
  -d @sample_bundle.json | python3 -m json.tool
```

`GET http://localhost:8000/attestation` returns `{"tee": false}` in this mode —
expected, since no dstack socket is mounted.

To enable free-text scrubbing locally:

```bash
SCRUB_FREETEXT=true docker compose -f docker-compose.local.yml up
```

Run the tests without Docker:

```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m spacy download en_core_web_sm   # needed for the free-text test
pytest    # test_scrub.py + test_llm.py; no Ollama server needed
```

## 2. Deploy to Phala

> The Phala/dstack tooling moves fast — check the exact CLI flags and the
> guest-agent socket path against the current Phala docs before deploying.

**a. Build and push the image** (Phala pulls from a registry; it does not build):

```bash
docker login                      # your registry first
export DEID_IMAGE=youruser/deid-service:latest
./build-and-push.sh
```

**b. Deploy the Phala compose file.** `DEID_IMAGE` (and any private registry
credentials) go through the encrypted `-e` env file, never the compose file:

```bash
cat > .env <<EOF
DEID_IMAGE=youruser/deid-service:latest
EOF

phala cvms create -n deid -c ./docker-compose.phala.yml -e .env --vcpu 16 --memory 49152
```

> **Sizing:** `qwen3:30b` needs ~19GB RAM plus ~18GB disk for the model
> volume — the old `--vcpu 1 --memory 4096` sizing cannot run it. Either
> provision a large CVM as above (CPU inference is still slow; raise
> `OLLAMA_TIMEOUT`), use a Phala GPU CVM, or set `OLLAMA_MODEL` to a smaller
> model (e.g. `qwen3:4b`) on constrained CVMs. If the model can't load, the
> service still boots and serves via the rules engine.

**c. Verify attestation.** Hit `/attestation` on the CVM endpoint; it should
return `{"tee": true, "quote": ...}`. Verify the quote against Phala's
attestation API to confirm the service is running inside a genuine TEE:

```bash
curl -s https://<your-cvm-endpoint>:8000/attestation
```

If `/attestation` returns `{"tee": false}` inside the CVM, the guest-agent
socket mount in `docker-compose.phala.yml` doesn't match the path your dstack
version uses (`/var/run/dstack.sock` in current dstack, `/var/run/tappd.sock`
in the older Tappd era) — adjust the volume mount.
