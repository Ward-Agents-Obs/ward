"""
OpenAI API call instrumentation.

Wraps OpenAI client methods via wrapt to create OTel spans for each call.
Handles sync/async and streaming/non-streaming transparently.

Streaming design:
    We can't use `with tracer.start_as_current_span()` for streaming because the
    span must stay open until the caller finishes consuming the iterator — well after
    the wrapper function returns. Instead we call `tracer.start_span()` and pass
    ownership to StreamWrapper/AsyncStreamWrapper, which call `span.end()` on
    exhaustion, error, or garbage collection.
"""

import time
from typing import Callable, Dict, Any
from opentelemetry import trace
from opentelemetry.trace import SpanKind
from ward.conventions import SemanticConventions
from ward.session import get_current_session_id, start_session
from ward.instrumentation.openai.utils import (
    set_server_address_and_port,
    handle_exception,
    response_to_dict,
)


class StreamWrapper:
    """
    Transparent proxy around an OpenAI sync stream.

    Yields chunks unchanged while accumulating token/usage data.
    Finalizes the OTel span once the stream is fully consumed or closed.
    """

    def __init__(self, stream, span, start_time, request_model, capture_message_content):
        self._stream = stream
        self._span = span
        self._start_time = start_time
        self._model = request_model
        self._capture_message_content = capture_message_content
        self._finish_reasons = []
        self._input_tokens = 0
        self._output_tokens = 0
        self._total_tokens = 0
        self._response_id = None
        self._chunks_content = []
        self._finalized = False

    def __iter__(self):
        return self

    def __next__(self):
        try:
            chunk = next(self._stream)
            self._process_chunk(chunk)
            return chunk
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

    @property
    def response(self):
        """Expose the underlying httpx response for callers that need it."""
        if hasattr(self._stream, "response"):
            return self._stream.response
        return None

    def _process_chunk(self, chunk):
        """Extract telemetry data from each streamed chunk."""
        chunk_dict = response_to_dict(chunk)

        if chunk_dict.get("id"):
            self._response_id = chunk_dict["id"]
        if chunk_dict.get("model"):
            self._model = chunk_dict["model"]

        # Usage stats arrive in the final chunk (requires stream_options.include_usage)
        usage = chunk_dict.get("usage")
        if usage and isinstance(usage, dict):
            self._input_tokens = usage.get("prompt_tokens", self._input_tokens)
            self._output_tokens = usage.get("completion_tokens", self._output_tokens)
            self._total_tokens = usage.get("total_tokens", self._total_tokens)

        for choice in chunk_dict.get("choices", []):
            if isinstance(choice, dict):
                if choice.get("finish_reason"):
                    self._finish_reasons.append(str(choice["finish_reason"]))
                delta = choice.get("delta", {})
                if isinstance(delta, dict) and delta.get("content"):
                    self._chunks_content.append(delta["content"])

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
        if self._total_tokens:
            self._span.set_attribute(SemanticConventions.GEN_AI_CLIENT_TOKEN_USAGE, self._total_tokens)
        if self._finish_reasons:
            self._span.set_attribute(
                SemanticConventions.GEN_AI_RESPONSE_FINISH_REASON,
                ",".join(self._finish_reasons),
            )
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
        # Safety net: end span if caller abandons the stream without consuming it
        self._end_span()


class AsyncStreamWrapper:
    """Async equivalent of StreamWrapper for AsyncOpenAI streaming."""

    def __init__(self, stream, span, start_time, request_model, capture_message_content):
        self._stream = stream
        self._span = span
        self._start_time = start_time
        self._model = request_model
        self._capture_message_content = capture_message_content
        self._finish_reasons = []
        self._input_tokens = 0
        self._output_tokens = 0
        self._total_tokens = 0
        self._response_id = None
        self._chunks_content = []
        self._finalized = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            chunk = await self._stream.__anext__()
            self._process_chunk(chunk)
            return chunk
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

    @property
    def response(self):
        if hasattr(self._stream, "response"):
            return self._stream.response
        return None

    def _process_chunk(self, chunk):
        chunk_dict = response_to_dict(chunk)

        if chunk_dict.get("id"):
            self._response_id = chunk_dict["id"]
        if chunk_dict.get("model"):
            self._model = chunk_dict["model"]

        usage = chunk_dict.get("usage")
        if usage and isinstance(usage, dict):
            self._input_tokens = usage.get("prompt_tokens", self._input_tokens)
            self._output_tokens = usage.get("completion_tokens", self._output_tokens)
            self._total_tokens = usage.get("total_tokens", self._total_tokens)

        for choice in chunk_dict.get("choices", []):
            if isinstance(choice, dict):
                if choice.get("finish_reason"):
                    self._finish_reasons.append(str(choice["finish_reason"]))
                delta = choice.get("delta", {})
                if isinstance(delta, dict) and delta.get("content"):
                    self._chunks_content.append(delta["content"])

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
        if self._total_tokens:
            self._span.set_attribute(SemanticConventions.GEN_AI_CLIENT_TOKEN_USAGE, self._total_tokens)
        if self._finish_reasons:
            self._span.set_attribute(
                SemanticConventions.GEN_AI_RESPONSE_FINISH_REASON,
                ",".join(self._finish_reasons),
            )
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
    if capture_message_content and "messages" in kwargs:
        for i, msg in enumerate(kwargs["messages"]):
            role = msg.get("role") if isinstance(msg, dict) else getattr(msg, "role", None)
            content = msg.get("content") if isinstance(msg, dict) else getattr(msg, "content", None)
            if role == "user" and content:
                span.set_attribute(f"{SemanticConventions.GEN_AI_USER_MESSAGE}.{i}", str(content))
            elif role == "system" and content:
                span.set_attribute(f"{SemanticConventions.GEN_AI_SYSTEM_MESSAGE}.{i}", str(content))

    for param in ["temperature", "max_tokens", "top_p", "frequency_penalty", "presence_penalty", "seed"]:
        if param in kwargs:
            attr_name = getattr(SemanticConventions, f"GEN_AI_REQUEST_{param.upper()}", None)
            if attr_name:
                span.set_attribute(attr_name, kwargs[param])


def create_wrapper(
    config: Dict[str, Any],
    operation_type: str,
    process_response_func: Callable,
    default_model: str,
) -> Callable:
    """
    Factory that returns a wrapt-compatible sync wrapper for one OpenAI endpoint.

    The returned wrapper has signature (wrapped, instance, args, kwargs) and
    creates an OTel span around the original call. For streaming calls, span
    ownership is transferred to a StreamWrapper.
    """
    tracer = config.get("tracer")
    pricing_info = config.get("pricing_info")
    environment = config.get("environment")
    application_name = config.get("application_name")
    metrics = config.get("metrics")
    capture_message_content = config.get("capture_message_content", True)
    disable_metrics = config.get("disable_metrics", False)
    version = config.get("version", "unknown")

    def wrapper(wrapped, instance, args, kwargs):
        server_address, server_port = set_server_address_and_port(instance, "api.openai.com", 443)
        request_model = kwargs.get("model", default_model)
        span_name = f"{operation_type} {request_model}"
        is_streaming = kwargs.get("stream", False)

        # Manual span management — streaming spans outlive this function scope
        span = tracer.start_span(span_name, kind=SpanKind.CLIENT)

        if span.is_recording():
            span.set_attribute(SemanticConventions.GEN_AI_SYSTEM, SemanticConventions.GEN_AI_SYSTEM_OPENAI)
            span.set_attribute(SemanticConventions.GEN_AI_OPERATION_TYPE, operation_type)
            span.set_attribute(SemanticConventions.GEN_AI_REQUEST_MODEL, request_model)
            span.set_attribute(SemanticConventions.SERVER_ADDRESS, server_address)
            span.set_attribute(SemanticConventions.SERVER_PORT, server_port)
            span.set_attribute(SemanticConventions.GEN_AI_ENDPOINT, f"{server_address}:{server_port}")

            # Add session tracking
            session_id = get_current_session_id()
            if not session_id:
                session_id = start_session()
            span.set_attribute(SemanticConventions.GEN_AI_SESSION_ID, session_id)

            _set_request_attributes(span, kwargs, capture_message_content)

        start_time = time.time()

        try:
            # Inject stream_options so the final chunk includes token usage
            if is_streaming and operation_type == SemanticConventions.GEN_AI_OPERATION_TYPE_CHAT:
                stream_opts = kwargs.get("stream_options") or {}
                if not stream_opts.get("include_usage"):
                    kwargs = {**kwargs, "stream_options": {**stream_opts, "include_usage": True}}

            response = wrapped(*args, **kwargs)

            if is_streaming:
                # Hand span ownership to StreamWrapper — it will call span.end()
                return StreamWrapper(response, span, start_time, request_model, capture_message_content)

            try:
                process_response_func(
                    response=response,
                    request_model=request_model,
                    pricing_info=pricing_info,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                    **kwargs,
                )
            except Exception as e:
                handle_exception(span, e)

            span.end()
            return response

        except Exception as e:
            handle_exception(span, e)
            span.end()
            raise

    return wrapper


def create_async_wrapper(
    config: Dict[str, Any],
    operation_type: str,
    process_response_func: Callable,
    default_model: str,
) -> Callable:
    """Async equivalent of create_wrapper for AsyncOpenAI client methods."""
    tracer = config.get("tracer")
    pricing_info = config.get("pricing_info")
    environment = config.get("environment")
    application_name = config.get("application_name")
    metrics = config.get("metrics")
    capture_message_content = config.get("capture_message_content", True)
    disable_metrics = config.get("disable_metrics", False)
    version = config.get("version", "unknown")

    async def async_wrapper(wrapped, instance, args, kwargs):
        server_address, server_port = set_server_address_and_port(instance, "api.openai.com", 443)
        request_model = kwargs.get("model", default_model)
        span_name = f"{operation_type} {request_model}"
        is_streaming = kwargs.get("stream", False)

        span = tracer.start_span(span_name, kind=SpanKind.CLIENT)

        if span.is_recording():
            span.set_attribute(SemanticConventions.GEN_AI_SYSTEM, SemanticConventions.GEN_AI_SYSTEM_OPENAI)
            span.set_attribute(SemanticConventions.GEN_AI_OPERATION_TYPE, operation_type)
            span.set_attribute(SemanticConventions.GEN_AI_REQUEST_MODEL, request_model)
            span.set_attribute(SemanticConventions.SERVER_ADDRESS, server_address)
            span.set_attribute(SemanticConventions.SERVER_PORT, server_port)
            span.set_attribute(SemanticConventions.GEN_AI_ENDPOINT, f"{server_address}:{server_port}")

            # Add session tracking
            session_id = get_current_session_id()
            if not session_id:
                session_id = start_session()
            span.set_attribute(SemanticConventions.GEN_AI_SESSION_ID, session_id)

            _set_request_attributes(span, kwargs, capture_message_content)

        start_time = time.time()

        try:
            if is_streaming and operation_type == SemanticConventions.GEN_AI_OPERATION_TYPE_CHAT:
                stream_opts = kwargs.get("stream_options") or {}
                if not stream_opts.get("include_usage"):
                    kwargs = {**kwargs, "stream_options": {**stream_opts, "include_usage": True}}

            response = await wrapped(*args, **kwargs)

            if is_streaming:
                return AsyncStreamWrapper(response, span, start_time, request_model, capture_message_content)

            try:
                process_response_func(
                    response=response,
                    request_model=request_model,
                    pricing_info=pricing_info,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                    **kwargs,
                )
            except Exception as e:
                handle_exception(span, e)

            span.end()
            return response

        except Exception as e:
            handle_exception(span, e)
            span.end()
            raise

    return async_wrapper


# ---------------------------------------------------------------------------
# Response processors
# ---------------------------------------------------------------------------

def process_chat_response(
    response, request_model, pricing_info, server_port, server_address,
    environment, application_name, metrics, start_time, span,
    capture_message_content, disable_metrics, version, **kwargs,
):
    """Process non-streaming chat completion response and set span attributes."""
    if not span.is_recording():
        return response

    duration = time.time() - start_time
    span.set_attribute(SemanticConventions.GEN_AI_CLIENT_OPERATION_DURATION, duration)

    response_dict = response_to_dict(response)

    if response_dict.get("id"):
        span.set_attribute(SemanticConventions.GEN_AI_RESPONSE_ID, response_dict["id"])
    if response_dict.get("model"):
        span.set_attribute(SemanticConventions.GEN_AI_RESPONSE_MODEL, response_dict["model"])
    if response_dict.get("system_fingerprint"):
        span.set_attribute(SemanticConventions.GEN_AI_RESPONSE_SYSTEM_FINGERPRINT, response_dict["system_fingerprint"])

    usage = response_dict.get("usage")
    if isinstance(usage, dict):
        input_tokens = usage.get("prompt_tokens")
        output_tokens = usage.get("completion_tokens")
        total_tokens = usage.get("total_tokens")
        reasoning_tokens = usage.get("reasoning_tokens")

        if input_tokens is not None:
            span.set_attribute(SemanticConventions.GEN_AI_USAGE_INPUT_TOKENS, input_tokens)
        if output_tokens is not None:
            span.set_attribute(SemanticConventions.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens)
        if total_tokens is not None:
            span.set_attribute(SemanticConventions.GEN_AI_CLIENT_TOKEN_USAGE, total_tokens)
        if reasoning_tokens is not None:
            span.set_attribute(SemanticConventions.GEN_AI_USAGE_REASONING_TOKENS, reasoning_tokens)

        _set_cost_attribute(span, pricing_info, response_dict.get("model", request_model), input_tokens, output_tokens)

    choices = response_dict.get("choices", [])
    finish_reasons = [
        str(c["finish_reason"])
        for c in choices
        if isinstance(c, dict) and c.get("finish_reason")
    ]
    if finish_reasons:
        span.set_attribute(SemanticConventions.GEN_AI_RESPONSE_FINISH_REASON, ",".join(finish_reasons))

    if capture_message_content and choices:
        for i, choice in enumerate(choices):
            if isinstance(choice, dict):
                message = choice.get("message", {})
                if isinstance(message, dict) and message.get("content"):
                    span.set_attribute(
                        f"{SemanticConventions.GEN_AI_ASSISTANT_MESSAGE}.{i}",
                        str(message["content"]),
                    )

    span.set_status(trace.Status(trace.StatusCode.OK))
    return response


def process_embedding_response(
    response, request_model, pricing_info, server_port, server_address,
    environment, application_name, metrics, start_time, span,
    capture_message_content, disable_metrics, version, **kwargs,
):
    """Process embedding response and set span attributes."""
    if not span.is_recording():
        return response

    duration = time.time() - start_time
    span.set_attribute(SemanticConventions.GEN_AI_CLIENT_OPERATION_DURATION, duration)

    response_dict = response_to_dict(response)

    if response_dict.get("model"):
        span.set_attribute(SemanticConventions.GEN_AI_RESPONSE_MODEL, response_dict["model"])

    usage = response_dict.get("usage")
    if isinstance(usage, dict):
        input_tokens = usage.get("prompt_tokens")
        total_tokens = usage.get("total_tokens")
        if input_tokens is not None:
            span.set_attribute(SemanticConventions.GEN_AI_USAGE_INPUT_TOKENS, input_tokens)
        if total_tokens is not None:
            span.set_attribute(SemanticConventions.GEN_AI_CLIENT_TOKEN_USAGE, total_tokens)

    data = response_dict.get("data")
    if isinstance(data, list):
        span.set_attribute("gen_ai.embedding.count", len(data))

    span.set_status(trace.Status(trace.StatusCode.OK))
    return response


def process_image_response(
    response, request_model, pricing_info, server_port, server_address,
    environment, application_name, metrics, start_time, span,
    capture_message_content, disable_metrics, version, **kwargs,
):
    """Process image generation response and set span attributes."""
    if not span.is_recording():
        return response

    duration = time.time() - start_time
    span.set_attribute(SemanticConventions.GEN_AI_CLIENT_OPERATION_DURATION, duration)

    response_dict = response_to_dict(response)
    data = response_dict.get("data")
    if isinstance(data, list):
        span.set_attribute("gen_ai.image.count", len(data))

    span.set_status(trace.Status(trace.StatusCode.OK))
    return response


def process_audio_response(
    response, request_model, pricing_info, server_port, server_address,
    environment, application_name, metrics, start_time, span,
    capture_message_content, disable_metrics, version, **kwargs,
):
    """Process audio response and set span attributes."""
    if not span.is_recording():
        return response

    duration = time.time() - start_time
    span.set_attribute(SemanticConventions.GEN_AI_CLIENT_OPERATION_DURATION, duration)
    span.set_status(trace.Status(trace.StatusCode.OK))
    return response


def _set_cost_attribute(span, pricing_info, model, input_tokens, output_tokens):
    """Calculate and set cost attribute if pricing info is available."""
    from ward.pricing import calculate_cost

    cost = calculate_cost(model, input_tokens or 0, output_tokens or 0, provider="openai")
    if cost is not None:
        span.set_attribute(SemanticConventions.GEN_AI_USAGE_COST, cost)


# ---------------------------------------------------------------------------
# Public wrapper factories
# ---------------------------------------------------------------------------

def chat_completions(config: Dict[str, Any]) -> Callable:
    return create_wrapper(config, SemanticConventions.GEN_AI_OPERATION_TYPE_CHAT, process_chat_response, "gpt-4o")


def responses(config: Dict[str, Any]) -> Callable:
    return create_wrapper(config, SemanticConventions.GEN_AI_OPERATION_TYPE_CHAT, process_chat_response, "gpt-4o")


def chat_completions_parse(config: Dict[str, Any]) -> Callable:
    return create_wrapper(config, SemanticConventions.GEN_AI_OPERATION_TYPE_CHAT, process_chat_response, "gpt-4o")


def embedding(config: Dict[str, Any]) -> Callable:
    return create_wrapper(config, SemanticConventions.GEN_AI_OPERATION_TYPE_EMBEDDING, process_embedding_response, "text-embedding-ada-002")


def image_generate(config: Dict[str, Any]) -> Callable:
    return create_wrapper(config, SemanticConventions.GEN_AI_OPERATION_TYPE_IMAGE, process_image_response, "dall-e-2")


def image_variatons(config: Dict[str, Any]) -> Callable:
    return create_wrapper(config, SemanticConventions.GEN_AI_OPERATION_TYPE_IMAGE, process_image_response, "dall-e-2")


def audio_create(config: Dict[str, Any]) -> Callable:
    return create_wrapper(config, SemanticConventions.GEN_AI_OPERATION_TYPE_AUDIO, process_audio_response, "tts-1")


# Async variants
def async_chat_completions(config: Dict[str, Any]) -> Callable:
    return create_async_wrapper(config, SemanticConventions.GEN_AI_OPERATION_TYPE_CHAT, process_chat_response, "gpt-4o")


def async_embedding(config: Dict[str, Any]) -> Callable:
    return create_async_wrapper(config, SemanticConventions.GEN_AI_OPERATION_TYPE_EMBEDDING, process_embedding_response, "text-embedding-ada-002")


def async_image_generate(config: Dict[str, Any]) -> Callable:
    return create_async_wrapper(config, SemanticConventions.GEN_AI_OPERATION_TYPE_IMAGE, process_image_response, "dall-e-2")


def async_audio_create(config: Dict[str, Any]) -> Callable:
    return create_async_wrapper(config, SemanticConventions.GEN_AI_OPERATION_TYPE_AUDIO, process_audio_response, "tts-1")
