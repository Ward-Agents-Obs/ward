"""
Anthropic API call instrumentation.

Same span lifecycle pattern as the OpenAI module — see openai.py module docstring.
Anthropic streaming uses SSE events (message_start, content_block_delta,
message_delta, message_stop) rather than OpenAI's chunk-per-choice format.
"""

import time
from typing import Callable, Dict, Any
from opentelemetry import trace
from opentelemetry.trace import SpanKind
from ward.conventions import SemanticConventions
from ward.session import get_current_session_id, start_session
from ward.instrumentation.openai.utils import handle_exception, response_to_dict


def _get_server_info(instance):
    """Extract server address/port from an Anthropic client instance."""
    server_address = "api.anthropic.com"
    server_port = 443
    client = instance
    if hasattr(instance, "_client"):
        client = instance._client
    if hasattr(client, "base_url") and client.base_url:
        from urllib.parse import urlparse
        parsed = urlparse(str(client.base_url))
        if parsed.hostname:
            server_address = parsed.hostname
        if parsed.port:
            server_port = parsed.port
    return server_address, server_port


class AnthropicStreamWrapper:
    """Wraps an Anthropic sync stream to capture telemetry."""

    def __init__(self, stream, span, start_time, request_model, capture_message_content):
        self._stream = stream
        self._span = span
        self._start_time = start_time
        self._model = request_model
        self._capture_message_content = capture_message_content
        self._input_tokens = 0
        self._output_tokens = 0
        self._response_id = None
        self._stop_reason = None
        self._chunks_content = []
        self._finalized = False

    def __iter__(self):
        return self

    def __next__(self):
        try:
            event = next(self._stream)
            self._process_event(event)
            return event
        except StopIteration:
            self._finalize_success()
            raise
        except Exception as e:
            handle_exception(self._span, e)
            self._end_span()
            raise

    def __enter__(self):
        if hasattr(self._stream, "__enter__"):
            self._stream.__enter__()
        return self

    def __exit__(self, *args):
        if hasattr(self._stream, "__exit__"):
            self._stream.__exit__(*args)
        self._finalize_success()

    def close(self):
        if hasattr(self._stream, "close"):
            self._stream.close()
        self._finalize_success()

    def _process_event(self, event):
        """
        Extract telemetry from an Anthropic SSE event.

        Anthropic streams emit typed events:
          - message_start  → message metadata + input token count
          - content_block_delta → streamed text chunks
          - message_delta  → output token count + stop reason
        """
        event_dict = response_to_dict(event)
        event_type = event_dict.get("type", "")

        if event_type == "message_start":
            message = event_dict.get("message", {})
            if isinstance(message, dict):
                self._response_id = message.get("id")
                self._model = message.get("model", self._model)
                usage = message.get("usage", {})
                if isinstance(usage, dict):
                    self._input_tokens = usage.get("input_tokens", 0)

        elif event_type == "content_block_delta":
            delta = event_dict.get("delta", {})
            if isinstance(delta, dict) and delta.get("text"):
                self._chunks_content.append(delta["text"])

        elif event_type == "message_delta":
            delta = event_dict.get("delta", {})
            if isinstance(delta, dict):
                self._stop_reason = delta.get("stop_reason")
            usage = event_dict.get("usage", {})
            if isinstance(usage, dict):
                self._output_tokens = usage.get("output_tokens", self._output_tokens)

    def _finalize_success(self):
        if self._finalized:
            return
        self._set_span_attributes()
        self._span.set_status(trace.Status(trace.StatusCode.OK))
        self._end_span()

    def _set_span_attributes(self):
        if not self._span.is_recording():
            return
        duration = time.time() - self._start_time
        self._span.set_attribute(SemanticConventions.GEN_AI_CLIENT_OPERATION_DURATION, duration)
        self._span.set_attribute(SemanticConventions.GEN_AI_REQUEST_IS_STREAM, True)
        if self._response_id:
            self._span.set_attribute(SemanticConventions.GEN_AI_RESPONSE_ID, self._response_id)
        if self._model:
            self._span.set_attribute(SemanticConventions.GEN_AI_RESPONSE_MODEL, self._model)
        if self._input_tokens:
            self._span.set_attribute(SemanticConventions.GEN_AI_USAGE_INPUT_TOKENS, self._input_tokens)
        if self._output_tokens:
            self._span.set_attribute(SemanticConventions.GEN_AI_USAGE_OUTPUT_TOKENS, self._output_tokens)
        if self._stop_reason:
            self._span.set_attribute(SemanticConventions.GEN_AI_RESPONSE_FINISH_REASON, self._stop_reason)
        if self._capture_message_content and self._chunks_content:
            self._span.set_attribute(
                f"{SemanticConventions.GEN_AI_ASSISTANT_MESSAGE}.0",
                "".join(self._chunks_content),
            )

    def _end_span(self):
        if not self._finalized:
            self._finalized = True
            self._span.end()

    def __del__(self):
        self._end_span()


class AsyncAnthropicStreamWrapper:
    """Async equivalent of AnthropicStreamWrapper."""

    def __init__(self, stream, span, start_time, request_model, capture_message_content):
        self._stream = stream
        self._span = span
        self._start_time = start_time
        self._model = request_model
        self._capture_message_content = capture_message_content
        self._input_tokens = 0
        self._output_tokens = 0
        self._response_id = None
        self._stop_reason = None
        self._chunks_content = []
        self._finalized = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            event = await self._stream.__anext__()
            self._process_event(event)
            return event
        except StopAsyncIteration:
            self._finalize_success()
            raise
        except Exception as e:
            handle_exception(self._span, e)
            self._end_span()
            raise

    async def __aenter__(self):
        if hasattr(self._stream, "__aenter__"):
            await self._stream.__aenter__()
        return self

    async def __aexit__(self, *args):
        if hasattr(self._stream, "__aexit__"):
            await self._stream.__aexit__(*args)
        self._finalize_success()

    def _process_event(self, event):
        event_dict = response_to_dict(event)
        event_type = event_dict.get("type", "")

        if event_type == "message_start":
            message = event_dict.get("message", {})
            if isinstance(message, dict):
                self._response_id = message.get("id")
                self._model = message.get("model", self._model)
                usage = message.get("usage", {})
                if isinstance(usage, dict):
                    self._input_tokens = usage.get("input_tokens", 0)
        elif event_type == "content_block_delta":
            delta = event_dict.get("delta", {})
            if isinstance(delta, dict) and delta.get("text"):
                self._chunks_content.append(delta["text"])
        elif event_type == "message_delta":
            delta = event_dict.get("delta", {})
            if isinstance(delta, dict):
                self._stop_reason = delta.get("stop_reason")
            usage = event_dict.get("usage", {})
            if isinstance(usage, dict):
                self._output_tokens = usage.get("output_tokens", self._output_tokens)

    def _finalize_success(self):
        if self._finalized:
            return
        self._set_span_attributes()
        self._span.set_status(trace.Status(trace.StatusCode.OK))
        self._end_span()

    def _set_span_attributes(self):
        if not self._span.is_recording():
            return
        duration = time.time() - self._start_time
        self._span.set_attribute(SemanticConventions.GEN_AI_CLIENT_OPERATION_DURATION, duration)
        self._span.set_attribute(SemanticConventions.GEN_AI_REQUEST_IS_STREAM, True)
        if self._response_id:
            self._span.set_attribute(SemanticConventions.GEN_AI_RESPONSE_ID, self._response_id)
        if self._model:
            self._span.set_attribute(SemanticConventions.GEN_AI_RESPONSE_MODEL, self._model)
        if self._input_tokens:
            self._span.set_attribute(SemanticConventions.GEN_AI_USAGE_INPUT_TOKENS, self._input_tokens)
        if self._output_tokens:
            self._span.set_attribute(SemanticConventions.GEN_AI_USAGE_OUTPUT_TOKENS, self._output_tokens)
        if self._stop_reason:
            self._span.set_attribute(SemanticConventions.GEN_AI_RESPONSE_FINISH_REASON, self._stop_reason)
        if self._capture_message_content and self._chunks_content:
            self._span.set_attribute(
                f"{SemanticConventions.GEN_AI_ASSISTANT_MESSAGE}.0",
                "".join(self._chunks_content),
            )

    def _end_span(self):
        if not self._finalized:
            self._finalized = True
            self._span.end()

    def __del__(self):
        self._end_span()


def _set_request_attributes(span, kwargs, capture_message_content):
    """Record prompt messages and model parameters as span attributes."""
    # Anthropic passes system prompt as a top-level kwarg, not inside messages
    if capture_message_content and "messages" in kwargs:
        for i, msg in enumerate(kwargs["messages"]):
            role = msg.get("role") if isinstance(msg, dict) else getattr(msg, "role", None)
            content = msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", None)
            if role == "user" and content:
                span.set_attribute(f"{SemanticConventions.GEN_AI_USER_MESSAGE}.{i}", str(content))

    if capture_message_content and "system" in kwargs:
        span.set_attribute(f"{SemanticConventions.GEN_AI_SYSTEM_MESSAGE}.0", str(kwargs["system"]))

    for param, attr in [
        ("temperature", SemanticConventions.GEN_AI_REQUEST_TEMPERATURE),
        ("max_tokens", SemanticConventions.GEN_AI_REQUEST_MAX_TOKENS),
        ("top_p", SemanticConventions.GEN_AI_REQUEST_TOP_P),
        ("top_k", SemanticConventions.GEN_AI_REQUEST_TOP_K),
    ]:
        if param in kwargs and kwargs[param] is not None:
            span.set_attribute(attr, kwargs[param])


def _process_message_response(response, span, start_time, request_model, pricing_info, capture_message_content):
    """Process a non-streaming Anthropic Messages response."""
    if not span.is_recording():
        return

    duration = time.time() - start_time
    span.set_attribute(SemanticConventions.GEN_AI_CLIENT_OPERATION_DURATION, duration)

    response_dict = response_to_dict(response)

    if response_dict.get("id"):
        span.set_attribute(SemanticConventions.GEN_AI_RESPONSE_ID, response_dict["id"])
    if response_dict.get("model"):
        span.set_attribute(SemanticConventions.GEN_AI_RESPONSE_MODEL, response_dict["model"])
    if response_dict.get("stop_reason"):
        span.set_attribute(SemanticConventions.GEN_AI_RESPONSE_FINISH_REASON, response_dict["stop_reason"])

    usage = response_dict.get("usage")
    input_tokens = 0
    output_tokens = 0
    if isinstance(usage, dict):
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)
        if input_tokens:
            span.set_attribute(SemanticConventions.GEN_AI_USAGE_INPUT_TOKENS, input_tokens)
        if output_tokens:
            span.set_attribute(SemanticConventions.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens)
        total = input_tokens + output_tokens
        if total:
            span.set_attribute(SemanticConventions.GEN_AI_CLIENT_TOKEN_USAGE, total)

    from ward.pricing import calculate_cost
    model = response_dict.get("model", request_model)
    cost = calculate_cost(model, input_tokens, output_tokens, provider="anthropic")
    if cost is not None:
        span.set_attribute(SemanticConventions.GEN_AI_USAGE_COST, cost)

    if capture_message_content:
        content_blocks = response_dict.get("content", [])
        if isinstance(content_blocks, list):
            for i, block in enumerate(content_blocks):
                if isinstance(block, dict) and block.get("text"):
                    span.set_attribute(
                        f"{SemanticConventions.GEN_AI_ASSISTANT_MESSAGE}.{i}",
                        str(block["text"]),
                    )

    span.set_status(trace.Status(trace.StatusCode.OK))


def messages_create(config: Dict[str, Any]) -> Callable:
    """Create a sync wrapper for Anthropic Messages.create."""
    tracer = config.get("tracer")
    pricing_info = config.get("pricing_info")
    capture_message_content = config.get("capture_message_content", True)

    def wrapper(wrapped, instance, args, kwargs):
        server_address, server_port = _get_server_info(instance)
        request_model = kwargs.get("model", "claude-sonnet-4-20250514")
        span_name = f"chat {request_model}"
        is_streaming = kwargs.get("stream", False)

        span = tracer.start_span(span_name, kind=SpanKind.CLIENT)

        if span.is_recording():
            span.set_attribute(SemanticConventions.GEN_AI_SYSTEM, SemanticConventions.GEN_AI_SYSTEM_ANTHROPIC)
            span.set_attribute(SemanticConventions.GEN_AI_OPERATION_TYPE, SemanticConventions.GEN_AI_OPERATION_TYPE_CHAT)
            span.set_attribute(SemanticConventions.GEN_AI_REQUEST_MODEL, request_model)
            span.set_attribute(SemanticConventions.SERVER_ADDRESS, server_address)
            span.set_attribute(SemanticConventions.SERVER_PORT, server_port)

            # Add session tracking
            session_id = get_current_session_id()
            if not session_id:
                session_id = start_session()
            span.set_attribute(SemanticConventions.GEN_AI_SESSION_ID, session_id)

            _set_request_attributes(span, kwargs, capture_message_content)

        start_time = time.time()

        try:
            response = wrapped(*args, **kwargs)

            if is_streaming:
                return AnthropicStreamWrapper(response, span, start_time, request_model, capture_message_content)

            _process_message_response(response, span, start_time, request_model, pricing_info, capture_message_content)
            span.end()
            return response
        except Exception as e:
            handle_exception(span, e)
            span.end()
            raise

    return wrapper


def async_messages_create(config: Dict[str, Any]) -> Callable:
    """Create an async wrapper for Anthropic AsyncMessages.create."""
    tracer = config.get("tracer")
    pricing_info = config.get("pricing_info")
    capture_message_content = config.get("capture_message_content", True)

    async def async_wrapper(wrapped, instance, args, kwargs):
        server_address, server_port = _get_server_info(instance)
        request_model = kwargs.get("model", "claude-sonnet-4-20250514")
        span_name = f"chat {request_model}"
        is_streaming = kwargs.get("stream", False)

        span = tracer.start_span(span_name, kind=SpanKind.CLIENT)

        if span.is_recording():
            span.set_attribute(SemanticConventions.GEN_AI_SYSTEM, SemanticConventions.GEN_AI_SYSTEM_ANTHROPIC)
            span.set_attribute(SemanticConventions.GEN_AI_OPERATION_TYPE, SemanticConventions.GEN_AI_OPERATION_TYPE_CHAT)
            span.set_attribute(SemanticConventions.GEN_AI_REQUEST_MODEL, request_model)
            span.set_attribute(SemanticConventions.SERVER_ADDRESS, server_address)
            span.set_attribute(SemanticConventions.SERVER_PORT, server_port)

            # Add session tracking
            session_id = get_current_session_id()
            if not session_id:
                session_id = start_session()
            span.set_attribute(SemanticConventions.GEN_AI_SESSION_ID, session_id)

            _set_request_attributes(span, kwargs, capture_message_content)

        start_time = time.time()

        try:
            response = await wrapped(*args, **kwargs)

            if is_streaming:
                return AsyncAnthropicStreamWrapper(response, span, start_time, request_model, capture_message_content)

            _process_message_response(response, span, start_time, request_model, pricing_info, capture_message_content)
            span.end()
            return response
        except Exception as e:
            handle_exception(span, e)
            span.end()
            raise

    return async_wrapper
