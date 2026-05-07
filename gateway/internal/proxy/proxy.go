package proxy

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	collecttracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	resourcev1 "go.opentelemetry.io/proto/otlp/resource/v1"
	"google.golang.org/protobuf/proto"

	"github.com/ward-dev/gateway/internal/middleware"
)

type Proxy struct {
	client       *http.Client
	collectorURL string
	// authToken is the shared secret the gateway presents to the collector
	// via `Authorization: Bearer <token>`. Defense-in-depth so that even if
	// the collector socket leaks onto a network beyond the gateway, only
	// gateway-issued payloads are accepted. Required (gateway main.go
	// fails-fast on an empty token); enforced collector-side by the
	// `bearertokenauth` extension in configs/otel-collector-config.yaml.
	authToken string
}

// New builds a proxy that forwards trace exports to the collector's /v1/traces
// endpoint, presenting `authToken` as a Bearer credential to the collector's
// bearertokenauth extension. Pass an empty token only in tests where the
// collector also has no auth configured.
func New(collectorAddr, authToken string) *Proxy {
	return &Proxy{
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		collectorURL: strings.TrimRight(collectorAddr, "/") + "/v1/traces",
		authToken:    authToken,
	}
}

// HandleTraces injects the authenticated tenant ID into OTLP resource attributes and forwards the payload upstream.
func (p *Proxy) HandleTraces(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok {
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read request body", http.StatusBadRequest)
		return
	}

	forwardBody, err := injectTenant(body, principal.TenantID)
	if err != nil {
		http.Error(w, "invalid OTLP payload", http.StatusBadRequest)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, p.collectorURL, bytes.NewReader(forwardBody))
	if err != nil {
		http.Error(w, "failed to prepare upstream request", http.StatusInternalServerError)
		return
	}

	copyHeaders(req.Header, r.Header)
	// Strip the SDK client's Authorization header (which carried the API key)
	// and replace with our internal collector-auth token. The collector's
	// bearertokenauth extension verifies this on the receiver side; without
	// it, any traffic that reaches the collector socket is rejected.
	req.Header.Del("Authorization")
	if p.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+p.authToken)
	}
	req.Header.Del("Content-Length")

	resp, err := p.client.Do(req)
	if err != nil {
		status := http.StatusBadGateway
		if _, parseErr := url.Parse(p.collectorURL); parseErr != nil {
			status = http.StatusInternalServerError
		}
		http.Error(w, fmt.Sprintf("collector request failed: %v", err), status)
		return
	}
	defer resp.Body.Close()

	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func injectTenant(body []byte, tenantID string) ([]byte, error) {
	req := &collecttracev1.ExportTraceServiceRequest{}
	if err := proto.Unmarshal(body, req); err != nil {
		return nil, err
	}

	for _, resourceSpans := range req.GetResourceSpans() {
		if resourceSpans.Resource == nil {
			resourceSpans.Resource = &resourcev1.Resource{}
		}
		upsertStringAttribute(resourceSpans.Resource, "ward.tenant_id", tenantID)
	}

	return proto.Marshal(req)
}

func upsertStringAttribute(resource *resourcev1.Resource, key string, value string) {
	for _, attr := range resource.Attributes {
		if attr.GetKey() == key {
			attr.Value = stringValue(value)
			return
		}
	}

	resource.Attributes = append(resource.Attributes, &commonv1.KeyValue{
		Key:   key,
		Value: stringValue(value),
	})
}

func stringValue(value string) *commonv1.AnyValue {
	return &commonv1.AnyValue{
		Value: &commonv1.AnyValue_StringValue{
			StringValue: value,
		},
	}
}

func copyHeaders(dst http.Header, src http.Header) {
	for key, values := range src {
		dst.Del(key)
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}
