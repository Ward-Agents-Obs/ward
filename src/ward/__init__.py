"""
Ward SDK - Zero-code observability for LLM applications.

Usage:
    import ward
    ward.init(otlp_endpoint="http://localhost:4318")

    # Your LLM calls are now automatically instrumented.
    from openai import OpenAI
    client = OpenAI()
    client.chat.completions.create(model="gpt-4o", messages=[...])
"""

from typing import Optional
from opentelemetry import trace as trace_api

from ward.otel.tracer import setup_tracing
from ward.otel.propagators import setup_propagators
from ward.instrument_mapper import get_instrumentor
from ward.session import (
    SessionContext,
    start_session,
    end_session,
    get_current_session_id,
    set_session_id,
)

__version__ = "0.1.0"


def init(
    application_name: Optional[str] = None,
    environment: Optional[str] = None,
    otlp_endpoint: Optional[str] = None,
    otlp_headers: Optional[dict] = None,
    instrumentations: Optional[list[str]] = None,
    disable_batch: bool = False,
    capture_message_content: bool = True,
    **kwargs,
) -> Optional[trace_api.Tracer]:
    """
    Initialize Ward SDK with tracing and instrumentations.

    Args:
        application_name: Name of your application (appears in traces).
        environment: Deployment environment (e.g. "production", "staging").
        otlp_endpoint: OTLP collector base URL (e.g. "http://localhost:4318").
                       The SDK appends /v1/traces automatically.

                       Security: this is the egress destination for every span
                       this SDK produces, including prompt/completion content
                       when `capture_message_content=True`. The SDK does not
                       validate the endpoint, verify TLS pinning, or enforce
                       a scheme. Callers are responsible for:
                         - using https:// in production (the SDK will not
                           reject http:// URLs)
                         - confirming the host is one you control (the URL
                           is treated as trusted)
                         - rotating any `Authorization`/`Bearer` value passed
                           via `otlp_headers` if the endpoint is ever changed
        otlp_headers: Optional headers dict for authenticated OTLP endpoints.
                      Treat any value here as a credential: do not log,
                      commit, or interpolate from untrusted sources.
        instrumentations: List of providers to instrument. Defaults to ["openai"].
                         Available: "openai", "anthropic".
        disable_batch: Use SimpleSpanProcessor instead of BatchSpanProcessor.
        capture_message_content: Whether to capture prompt/response content in spans.
                                 Default True. Set False to keep prompts and
                                 completions out of traces (recommended if your
                                 LLM calls handle PII or regulated content).

    Returns:
        Configured OpenTelemetry tracer, or None if setup fails.
    """

    tracer = setup_tracing(
        application_name=application_name,
        environment=environment,
        otlp_endpoint=otlp_endpoint,
        otlp_headers=otlp_headers,
        disable_batch=disable_batch,
    )

    if tracer is None:
        return None

    setup_propagators()

    if instrumentations is None:
        instrumentations = ["openai"]

    for name in instrumentations:
        try:
            InstrumentorClass = get_instrumentor(name)
            instrumentor = InstrumentorClass(
                tracer=tracer,
                environment=environment,
                application_name=application_name,
                capture_message_content=capture_message_content,
            )
            instrumentor.instrument()
        except ImportError:
            pass
        except Exception as e:
            print(f"Warning: Failed to instrument {name}: {e}")

    return tracer
