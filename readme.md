# Ward SDK

**Zero-code observability for LLM applications.**

Ward instruments your LLM calls with [OpenTelemetry](https://opentelemetry.io/) — one line of code gives you full tracing, token tracking, latency metrics, and cost visibility. Ship traces to any OTel-compatible backend (Grafana, Jaeger, Datadog, etc.).

## Quick Start

```bash
pip install ward-sdk[openai]
```

```python
import ward
ward.init(otlp_endpoint="http://localhost:4318")

from openai import OpenAI
client = OpenAI()
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}],
)
# Traces are captured automatically — no code changes needed.
```

## Features

- **Zero-code instrumentation** — `ward.init()` patches LLM clients at import time via [wrapt](https://github.com/GrahamDumpleton/wrapt)
- **Streaming support** — full telemetry for streaming responses (auto-injects `stream_options` for token data)
- **Async support** — instruments both sync and async clients
- **Cost tracking** — automatic USD cost calculation for common models
- **OpenTelemetry native** — standard GenAI semantic conventions, works with any OTel backend
- **Multiple providers** — OpenAI and Anthropic out of the box

## Supported Providers

| Provider | Sync | Async | Streaming | Cost Tracking |
|----------|------|-------|-----------|---------------|
| OpenAI | Yes | Yes | Yes | Yes |
| Anthropic | Yes | Yes | Yes | Yes |

## Installation

```bash
# OpenAI only
pip install ward-sdk[openai]

# Anthropic only
pip install ward-sdk[anthropic]

# Both
pip install ward-sdk[all]
```

## Usage

### Basic (OpenAI)

```python
import ward

ward.init(
    application_name="my-app",
    environment="production",
    otlp_endpoint="http://localhost:4318",
)

from openai import OpenAI
client = OpenAI()
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Explain quantum computing"}],
)
```

### Anthropic

```python
import ward

ward.init(
    instrumentations=["anthropic"],
    otlp_endpoint="http://localhost:4318",
)

import anthropic
client = anthropic.Anthropic()
message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Explain quantum computing"}],
)
```

### Both providers

```python
ward.init(
    instrumentations=["openai", "anthropic"],
    otlp_endpoint="http://localhost:4318",
)
```

### Streaming

Streaming works automatically. Ward wraps the stream iterator and captures telemetry when the stream completes:

```python
stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Write a poem"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
# Span is finalized with full token counts when the stream ends.
```

### Async

```python
from openai import AsyncOpenAI

client = AsyncOpenAI()
response = await client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

### Disable content capture

For privacy, you can disable prompt/response logging:

```python
ward.init(
    otlp_endpoint="http://localhost:4318",
    capture_message_content=False,
)
```

## Local Observability Stack

Ward ships a Docker Compose stack with ClickHouse, OpenTelemetry Collector, and Grafana:

```bash
docker-compose up -d
```

This starts:

| Service | Port | Purpose |
|---------|------|---------|
| ClickHouse | 8123, 9000 | Trace storage |
| OTLP Collector | 4317, 4318 | Receives traces via gRPC/HTTP |
| Grafana | 3000 | Dashboards (admin/admin) |

A pre-built LLM Traces dashboard is provisioned automatically at [http://localhost:3000](http://localhost:3000).

## Production deployment

The local Compose file ships with deliberately weak defaults (`otelpass`, `postgres`, `admin`) so that `docker compose up` Just Works for new contributors. **Every credential is pulled in via `${VAR:-default}` substitution, so production deploys can override every default by sourcing a different env file** — without touching `docker-compose.yaml`. See `.env.example` for the canonical list and per-variable comments.

### Required overrides for any non-local deploy

| Variable | Notes |
|---|---|
| `COLLECTOR_AUTH_TOKEN` | **Required, no default.** Both gateway and collector refuse to start without it. Generate fresh: `openssl rand -hex 32`. |
| `REDIS_PASSWORD` | **Required for prod.** The redis service runs with `--requirepass $REDIS_PASSWORD`; the gateway (`cmd/gateway/main.go`) and the dashboard (`lib/redis.ts`) BOTH hard-fail at boot if empty so an operator misconfig (e.g. forgotten password on the redis task itself) can't silently downgrade the stack to anonymous Redis. Generate fresh: `openssl rand -hex 32`. Use a url-safe value (alphanumeric + `_-`) if you embed it in a custom `REDIS_URL`. |
| `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` | The dashboard's `lib/clickhouse.ts` hard-fails at module load if either is missing — no compiled-in fallback. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Match the values referenced by `DATABASE_URL` below. |
| `DATABASE_URL` | Either a DSN that points at the in-stack `postgres` service or an external Postgres (Supabase, RDS). The dashboard's Prisma client and the gateway's API-key hydrate (#26) both read this. |
| `GF_SECURITY_ADMIN_USER`, `GF_SECURITY_ADMIN_PASSWORD` | The default `admin/admin` would be an obvious initial-foothold gift to anyone scanning :3000 in any deploy that exposes it. |

**Dashboard infra coupling.** The dashboard's runtime (Vercel / Render / etc.) is not in the `infra/*.tf` Terraform — those manifests cover gateway, collector, redis, and clickhouse only. Set `REDIS_PASSWORD` (and the other variables above) in whatever runtime hosts the dashboard, with the same value as the rest of the stack. Treat it like `NEXT_PUBLIC_SUPABASE_URL`: an operator obligation, surfaced via the dashboard's hard-fail on missing env.

### Suggested invocation

Keep production secrets in a separate file (e.g. `.env.production`, gitignored or sourced from a secrets manager) and pass it explicitly:

```bash
docker compose --env-file .env.production up -d
```

Compose's `${VAR:-default}` syntax keeps the defaults active when the override is empty, so a partially-populated env file silently uses dev creds for anything you forgot. **For prod, ensure every variable in the table above is present in `.env.production`** — the smoke test is `docker compose config --env-file .env.production` and grepping for any of `otelpass`, `postgres`, `admin`, `devredispass` in the rendered output.

V1.1 progress: #34 (Redis auth via Secrets Manager) and #35 (ClickHouse password migration) move the credential plumbing through AWS Secrets Manager / ECS `secrets` arrays so nothing rides on the env-file pattern in the cloud deploy for the migrated services. The Redis password is already on this path (`infra/services/redis.tf::aws_secretsmanager_secret`); the rest follow under #35. Until then, `--env-file` is the supported path for the un-migrated services.

## Configuration

### `ward.init()` parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `application_name` | `str` | `None` | Service name in traces |
| `environment` | `str` | `None` | Deployment environment |
| `otlp_endpoint` | `str` | `None` | OTLP collector base URL (SDK appends `/v1/traces`) |
| `otlp_headers` | `dict` | `None` | Auth headers for OTLP endpoint |
| `instrumentations` | `list[str]` | `["openai"]` | Providers to instrument |
| `disable_batch` | `bool` | `False` | Use SimpleSpanProcessor |
| `capture_message_content` | `bool` | `True` | Log prompt/response text |

### Environment variables

| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Fallback OTLP endpoint |
| `OTEL_EXPORTER_OTLP_HEADERS` | Fallback OTLP headers |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http` (default) or `grpc` |

### Security: what leaves the SDK

`otlp_endpoint` is the egress destination for every span. If `capture_message_content=True` (the default), spans include prompt and completion text. Ward does not validate the endpoint, enforce TLS, or pin certificates — treat the URL as a trusted boundary you own:

- Use `https://` in production. The SDK will not reject `http://`.
- Treat any value passed via `otlp_headers` (e.g. `Authorization: Bearer <key>`) as a credential. Read it from environment, not from a string literal in source.
- If your LLM calls handle PII or regulated content, set `capture_message_content=False` to keep prompts and completions out of traces.
- Rotate the API key you pass via `otlp_headers` whenever the endpoint changes.

## Span Attributes

Ward follows the [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/):

| Attribute | Example |
|-----------|---------|
| `gen_ai.system` | `openai`, `anthropic` |
| `gen_ai.request.model` | `gpt-4o` |
| `gen_ai.response.model` | `gpt-4o-2024-11-20` |
| `gen_ai.usage.input_tokens` | `150` |
| `gen_ai.usage.output_tokens` | `42` |
| `gen_ai.usage.cost` | `0.000795` |
| `gen_ai.client.operation.duration` | `1.234` |
| `gen_ai.response.finish_reasons` | `stop` |

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest src/tests/ -v

# Run integration test (requires OPENAI_API_KEY)
python src/tests/openai_test.py
```

## Architecture

```
Your Code
  → ward.init() patches LLM clients via wrapt
    → LLM call intercepted, OTel span created
      → Request attributes set (model, messages, params)
      → Original LLM call executes
      → Response attributes set (tokens, cost, latency)
    → Span exported via OTLP
      → OTel Collector → ClickHouse → Grafana
```

## License

MIT
