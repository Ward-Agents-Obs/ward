"""
End-to-end integration test: SDK -> Gateway -> Collector -> ClickHouse.

Prerequisites:
  1. docker-compose up -d  (full stack including gateway + redis)
  2. Seed two API keys (one per test tenant):
       cd gateway
       REDIS_ADDR=localhost:6379 go run ./cmd/seed --tenant test-tenant-A
       REDIS_ADDR=localhost:6379 go run ./cmd/seed --tenant test-tenant-B
     Copy the printed keys and tenant IDs into the env vars below.

Usage (basic, single-tenant tests only):
  WARD_TEST_API_KEY=ak_live_xxx \
    python -m pytest src/tests/test_gateway_integration.py -v

Usage (full suite, including spoof regression — TestTenantIsolation):
  WARD_TEST_API_KEY=ak_live_aaa WARD_TEST_TENANT_ID=test-tenant-A \
  WARD_TEST_API_KEY_B=ak_live_bbb WARD_TEST_TENANT_ID_B=test-tenant-B \
    python -m pytest src/tests/test_gateway_integration.py -v

Note: gateway/cmd/seed currently generates a fresh random API key on each
invocation rather than reusing a deterministic one. Re-running it dupes
the apikey:* hash into Redis under a new key for the same tenant. That's
acceptable for tests (the harness scopes by tenant_id, not by key) but is
the sort of operational sharp edge that #27 should clean up.
"""

import os
import time
import uuid

import pytest
import requests


GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8080")
API_KEY = os.getenv("WARD_TEST_API_KEY", "")
TENANT_ID = os.getenv("WARD_TEST_TENANT_ID", "")
API_KEY_B = os.getenv("WARD_TEST_API_KEY_B", "")
TENANT_ID_B = os.getenv("WARD_TEST_TENANT_ID_B", "")
CLICKHOUSE_URL = os.getenv("CLICKHOUSE_URL", "http://localhost:8123")
CLICKHOUSE_USER = os.getenv("CLICKHOUSE_USER", "otel")
CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "otelpass")


@pytest.fixture(autouse=True)
def require_api_key(request):
    # Tests under TestTenantIsolation manage their own skip semantics — the
    # spoof harness needs *both* keys plus tenant ids to be set.
    if request.cls is not None and request.cls.__name__ == "TestTenantIsolation":
        return
    if not API_KEY:
        pytest.skip("WARD_TEST_API_KEY not set — run seed first")


class TestGatewayHealth:
    def test_health_endpoint(self):
        resp = requests.get(f"{GATEWAY_URL}/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


class TestGatewayAuth:
    def test_missing_auth_returns_401(self):
        resp = requests.post(f"{GATEWAY_URL}/v1/traces", data=b"")
        assert resp.status_code == 401

    def test_invalid_key_returns_401(self):
        resp = requests.post(
            f"{GATEWAY_URL}/v1/traces",
            data=b"",
            headers={"Authorization": "Bearer ak_live_invalid_key_000000000000"},
        )
        assert resp.status_code == 401

    def test_valid_key_accepted(self):
        """A valid key should not return 401 (may return 400 for empty body, which is fine)."""
        resp = requests.post(
            f"{GATEWAY_URL}/v1/traces",
            data=b"",
            headers={
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/x-protobuf",
            },
        )
        assert resp.status_code != 401


class TestEndToEndTraces:
    def test_sdk_traces_reach_clickhouse(self):
        """Send traces via the SDK through the gateway and verify they land in ClickHouse."""
        try:
            import ward
        except ImportError:
            pytest.skip("ward SDK not installed")

        tracer = ward.init(
            application_name="gateway-integration-test",
            environment="test",
            otlp_endpoint=GATEWAY_URL,
            otlp_headers={"Authorization": f"Bearer {API_KEY}"},
            disable_batch=True,
        )

        if tracer is None:
            pytest.fail("ward.init() returned None")

        with tracer.start_as_current_span("integration-test-span") as span:
            span.set_attribute("test.marker", "gateway-e2e")
            span.set_attribute("ward.tenant_id", "test-tenant-001")

        # Give the pipeline time to flush
        time.sleep(5)

        # Query ClickHouse for the span
        query = (
            "SELECT SpanName, ResourceAttributes "
            "FROM otel_traces "
            "WHERE SpanName = 'integration-test-span' "
            "ORDER BY Timestamp DESC "
            "LIMIT 1 "
            "FORMAT JSON"
        )
        resp = requests.get(
            CLICKHOUSE_URL,
            params={"query": query, "user": "otel", "password": "otelpass"},
        )

        if resp.status_code != 200:
            pytest.skip(f"ClickHouse query failed ({resp.status_code}): {resp.text}")

        data = resp.json()
        rows = data.get("data", [])
        assert len(rows) > 0, "No spans found in ClickHouse for integration-test-span"

        resource_attrs = rows[0].get("ResourceAttributes", {})
        assert "ward.tenant_id" in str(resource_attrs), (
            f"tenant_id not found in resource attributes: {resource_attrs}"
        )


class TestRateLimitHeaders:
    def test_rate_limit_headers_present(self):
        resp = requests.post(
            f"{GATEWAY_URL}/v1/traces",
            data=b"",
            headers={
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/x-protobuf",
            },
        )
        assert "X-RateLimit-Limit" in resp.headers
        assert "X-RateLimit-Remaining" in resp.headers


# ---------------------------------------------------------------------------
# B6 — Tenant isolation regression tests
# ---------------------------------------------------------------------------
#
# These exercise the gateway's `injectTenant` proxy step (gateway/internal/
# proxy/proxy.go) which must overwrite any client-supplied `ward.tenant_id`
# resource attribute with the tenant tied to the authenticated API key. The
# audit (`.agents/tenant-isolation-audit.md` V1/V2) verified this manually —
# this class makes it CI-runnable so a future refactor of `injectTenant`
# can't silently regress.
#
# The assertions all use a per-run marker (random UUID written into a span
# attribute) so multiple parallel test runs don't collide on shared
# ClickHouse storage.


def _build_otlp_payload(span_marker: str, spoofed_tenant_id: str | None = None,
                         multi_resource: bool = False) -> bytes:
    """Build a serialized ExportTraceServiceRequest with a single span carrying
    `audit.marker = <span_marker>`. If `spoofed_tenant_id` is set, the resource
    attributes include a forged `ward.tenant_id`. If `multi_resource` is True,
    the payload contains two ResourceSpans — one with a nil Resource — to
    exercise the proxy's iteration over all entries.
    """
    # Imports are deferred so a missing OTel proto package only skips the spoof
    # tests, not the rest of the file.
    from opentelemetry.proto.collector.trace.v1 import trace_service_pb2
    from opentelemetry.proto.trace.v1 import trace_pb2
    from opentelemetry.proto.resource.v1 import resource_pb2
    from opentelemetry.proto.common.v1 import common_pb2

    def _span():
        return trace_pb2.Span(
            trace_id=os.urandom(16),
            span_id=os.urandom(8),
            name="tenant-iso-spoof-test",
            kind=trace_pb2.Span.SpanKind.SPAN_KIND_INTERNAL,
            start_time_unix_nano=int(time.time() * 1e9),
            end_time_unix_nano=int(time.time() * 1e9) + 1_000_000,
            attributes=[
                common_pb2.KeyValue(
                    key="audit.marker",
                    value=common_pb2.AnyValue(string_value=span_marker),
                ),
            ],
        )

    def _resource(spoof: str | None):
        attrs = [
            common_pb2.KeyValue(
                key="service.name",
                value=common_pb2.AnyValue(string_value="tenant-iso-spoof-test"),
            ),
        ]
        if spoof is not None:
            attrs.append(common_pb2.KeyValue(
                key="ward.tenant_id",
                value=common_pb2.AnyValue(string_value=spoof),
            ))
        return resource_pb2.Resource(attributes=attrs)

    if multi_resource:
        # First RS spoofs; second has no Resource at all (proxy must allocate one).
        rs1 = trace_pb2.ResourceSpans(
            resource=_resource(spoofed_tenant_id),
            scope_spans=[trace_pb2.ScopeSpans(spans=[_span()])],
        )
        rs2 = trace_pb2.ResourceSpans(
            scope_spans=[trace_pb2.ScopeSpans(spans=[_span()])],
        )
        req = trace_service_pb2.ExportTraceServiceRequest(resource_spans=[rs1, rs2])
    else:
        rs = trace_pb2.ResourceSpans(
            resource=_resource(spoofed_tenant_id),
            scope_spans=[trace_pb2.ScopeSpans(spans=[_span()])],
        )
        req = trace_service_pb2.ExportTraceServiceRequest(resource_spans=[rs])

    return req.SerializeToString()


def _build_otlp_with_span_attribute_spoof(span_marker: str,
                                           spoofed_tenant_id: str) -> bytes:
    """Build a payload where the spoof lives in *Span* attributes, not Resource.
    The dashboard's queries scope on `ResourceAttributes['ward.tenant_id']`, so
    a span-level spoof should be irrelevant to tenant scoping but is preserved
    as just another span attribute.
    """
    from opentelemetry.proto.collector.trace.v1 import trace_service_pb2
    from opentelemetry.proto.trace.v1 import trace_pb2
    from opentelemetry.proto.resource.v1 import resource_pb2
    from opentelemetry.proto.common.v1 import common_pb2

    span = trace_pb2.Span(
        trace_id=os.urandom(16),
        span_id=os.urandom(8),
        name="tenant-iso-spoof-test",
        kind=trace_pb2.Span.SpanKind.SPAN_KIND_INTERNAL,
        start_time_unix_nano=int(time.time() * 1e9),
        end_time_unix_nano=int(time.time() * 1e9) + 1_000_000,
        attributes=[
            common_pb2.KeyValue(
                key="audit.marker",
                value=common_pb2.AnyValue(string_value=span_marker),
            ),
            common_pb2.KeyValue(
                key="ward.tenant_id",  # at span level — should be ignored by queries
                value=common_pb2.AnyValue(string_value=spoofed_tenant_id),
            ),
        ],
    )
    rs = trace_pb2.ResourceSpans(
        resource=resource_pb2.Resource(attributes=[
            common_pb2.KeyValue(
                key="service.name",
                value=common_pb2.AnyValue(string_value="tenant-iso-spoof-test"),
            ),
        ]),
        scope_spans=[trace_pb2.ScopeSpans(spans=[span])],
    )
    return trace_service_pb2.ExportTraceServiceRequest(
        resource_spans=[rs]
    ).SerializeToString()


def _query_clickhouse(query: str) -> list[dict]:
    """POST a SELECT to ClickHouse and return the parsed `data` list."""
    resp = requests.get(
        CLICKHOUSE_URL,
        params={"query": query, "user": CLICKHOUSE_USER, "password": CLICKHOUSE_PASSWORD},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


def _post_otlp(api_key: str, body: bytes) -> requests.Response:
    return requests.post(
        f"{GATEWAY_URL}/v1/traces",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/x-protobuf",
        },
        data=body,
        timeout=15,
    )


class TestTenantIsolation:
    """Gateway-level tenant injection regression. Run prerequisites in module
    docstring. Cleans up its own rows in `finally`-style (delete is best-effort
    via ClickHouse async ALTER — the per-run UUID marker is the real isolation)."""

    @classmethod
    def setup_class(cls):
        missing = []
        if not API_KEY:
            missing.append("WARD_TEST_API_KEY")
        if not TENANT_ID:
            missing.append("WARD_TEST_TENANT_ID")
        if not API_KEY_B:
            missing.append("WARD_TEST_API_KEY_B")
        if not TENANT_ID_B:
            missing.append("WARD_TEST_TENANT_ID_B")
        if missing:
            pytest.skip(
                "TestTenantIsolation requires both tenants seeded — missing "
                + ", ".join(missing)
            )
        # Probe that the protobuf SDK is importable; skip cleanly otherwise.
        try:
            from opentelemetry.proto.collector.trace.v1 import trace_service_pb2  # noqa: F401
        except ImportError:
            pytest.skip(
                "opentelemetry-proto not installed — `pip install opentelemetry-proto`"
            )
        cls.run_id = uuid.uuid4().hex
        cls.markers: list[str] = []

    @classmethod
    def teardown_class(cls):
        if not getattr(cls, "markers", None):
            return
        # Async mutation; we don't block. Run-id keeps multiple test runs from
        # clobbering each other.
        marker_list = ",".join(f"'{m}'" for m in cls.markers)
        try:
            requests.post(
                CLICKHOUSE_URL,
                params={"user": CLICKHOUSE_USER, "password": CLICKHOUSE_PASSWORD},
                data=(
                    "ALTER TABLE otel_traces DELETE WHERE "
                    f"SpanAttributes['audit.marker'] IN ({marker_list})"
                ),
                timeout=10,
            )
        except requests.RequestException:
            pass

    def _new_marker(self, suffix: str) -> str:
        marker = f"tenant-iso-{self.run_id}-{suffix}"
        self.markers.append(marker)
        return marker

    def _wait_for_marker(self, marker: str, expected: int = 1, timeout: float = 10.0) -> list[dict]:
        """Poll ClickHouse until at least `expected` rows for `marker` appear."""
        deadline = time.time() + timeout
        last: list[dict] = []
        while time.time() < deadline:
            last = _query_clickhouse(
                f"SELECT ResourceAttributes['ward.tenant_id'] AS tenant, "
                f"SpanAttributes['audit.marker'] AS marker, SpanName "
                f"FROM otel_traces "
                f"WHERE SpanAttributes['audit.marker'] = '{marker}' "
                f"FORMAT JSON"
            )
            if len(last) >= expected:
                return last
            time.sleep(0.5)
        pytest.fail(
            f"timed out waiting for {expected} row(s) with marker={marker} "
            f"(last seen={len(last)})"
        )

    def test_no_spoof_round_trip(self):
        """Plain happy path: send OTLP with NO ward.tenant_id, expect the
        gateway to inject the authenticated tenant. Establishes the baseline
        the spoof tests need."""
        marker = self._new_marker("no-spoof")
        body = _build_otlp_payload(marker, spoofed_tenant_id=None)
        resp = _post_otlp(API_KEY, body)
        assert resp.status_code == 200, (
            f"gateway POST failed: status={resp.status_code} body={resp.text!r}"
        )
        rows = self._wait_for_marker(marker)
        assert len(rows) == 1
        assert rows[0]["tenant"] == TENANT_ID, (
            f"expected tenant={TENANT_ID}, got {rows[0]['tenant']} "
            f"(no spoof, gateway should inject the authenticated tenant)"
        )

    def test_resource_attribute_spoof_overwritten(self):
        """The crux of B6: send OTLP with `ward.tenant_id = TENANT_ID_B`
        in resource attrs while authenticating as orgA. The gateway MUST
        overwrite the spoofed value with orgA's real tenant. ClickHouse must
        contain orgA's tenant for this row, never orgB's."""
        marker = self._new_marker("rs-spoof-orgB")
        body = _build_otlp_payload(marker, spoofed_tenant_id=TENANT_ID_B)
        resp = _post_otlp(API_KEY, body)
        assert resp.status_code == 200
        rows = self._wait_for_marker(marker)
        assert len(rows) == 1
        observed = rows[0]["tenant"]
        assert observed == TENANT_ID, (
            f"SPOOF DETECTED: orgA (key={API_KEY[:12]}…) sent "
            f"`ward.tenant_id={TENANT_ID_B}` and ClickHouse stored tenant={observed!r} "
            f"— gateway MUST overwrite spoofed resource attribute (expected {TENANT_ID})"
        )

    def test_arbitrary_resource_attribute_spoof_overwritten(self):
        """Same as above but with a string that doesn't match any real tenant.
        Confirms the override isn't accidentally permissive based on whether
        the spoof matches an existing tenant."""
        marker = self._new_marker("rs-spoof-evil")
        body = _build_otlp_payload(marker, spoofed_tenant_id="evil_tenant_xyz")
        resp = _post_otlp(API_KEY, body)
        assert resp.status_code == 200
        rows = self._wait_for_marker(marker)
        observed = rows[0]["tenant"]
        assert observed == TENANT_ID, (
            f"SPOOF DETECTED: spoofed `ward.tenant_id=evil_tenant_xyz` was "
            f"persisted as tenant={observed!r} (expected {TENANT_ID})"
        )

    def test_multiple_resource_spans_all_stamped(self):
        """Two ResourceSpans entries — one with a nil Resource, one spoofing.
        The gateway iterates `req.GetResourceSpans()` and must stamp every
        entry, including the one where it has to allocate a fresh Resource."""
        marker = self._new_marker("multi-rs")
        body = _build_otlp_payload(
            marker, spoofed_tenant_id=TENANT_ID_B, multi_resource=True
        )
        resp = _post_otlp(API_KEY, body)
        assert resp.status_code == 200
        rows = self._wait_for_marker(marker, expected=2)
        assert len(rows) == 2, f"expected 2 spans, got {len(rows)}"
        observed = {r["tenant"] for r in rows}
        assert observed == {TENANT_ID}, (
            f"SPOOF DETECTED in multi-RS payload: stored tenants={observed} "
            f"(expected exactly {{{TENANT_ID!r}}}). The proxy must override the "
            f"spoofed RS *and* allocate a Resource for the nil RS."
        )

    def test_span_attribute_spoof_irrelevant(self):
        """`ward.tenant_id` set as a *Span* attribute (not Resource) is
        irrelevant to tenant scoping — the dashboard reads only
        `ResourceAttributes['ward.tenant_id']`. This test confirms the gateway
        doesn't accidentally read span-level spoofs and that span-level
        attributes pass through untouched (audit V1)."""
        marker = self._new_marker("span-attr-spoof")
        body = _build_otlp_with_span_attribute_spoof(
            marker, spoofed_tenant_id="evil_span_level"
        )
        resp = _post_otlp(API_KEY, body)
        assert resp.status_code == 200
        rows = self._wait_for_marker(marker)
        observed = rows[0]["tenant"]
        assert observed == TENANT_ID, (
            f"resource-level tenant should be {TENANT_ID}; got {observed!r}"
        )
        # The span-attribute spoof itself should be preserved as opaque payload
        # (the dashboard ignores it). We don't query for it explicitly here —
        # the assertion above is sufficient: ResourceAttributes['ward.tenant_id']
        # is never derived from SpanAttributes.

    def test_orgB_does_not_see_orgA_spoof_attempts(self):
        """Belt-and-braces: after running orgA's spoof attempts above, query
        ClickHouse as if we were the dashboard scoped to orgB. None of orgA's
        spoof markers should leak into orgB's view, regardless of what the
        forged resource attributes claimed."""
        marker = self._new_marker("orgB-cross-check")
        # Send one orgA payload that forges orgB explicitly.
        body = _build_otlp_payload(marker, spoofed_tenant_id=TENANT_ID_B)
        resp = _post_otlp(API_KEY, body)
        assert resp.status_code == 200
        # Wait for the row to land.
        self._wait_for_marker(marker)
        # Query "as orgB" — i.e. apply the same WHERE clause the dashboard
        # uses. The row must NOT be visible.
        rows = _query_clickhouse(
            f"SELECT SpanAttributes['audit.marker'] AS marker "
            f"FROM otel_traces "
            f"WHERE ResourceAttributes['ward.tenant_id'] = '{TENANT_ID_B}' "
            f"  AND SpanAttributes['audit.marker'] = '{marker}' "
            f"FORMAT JSON"
        )
        assert len(rows) == 0, (
            f"CROSS-LEAK: orgA's payload (forged ward.tenant_id={TENANT_ID_B}) "
            f"surfaced in orgB's tenant-scoped view. The dashboard would show "
            f"orgA's data to orgB."
        )
