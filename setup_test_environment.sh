#!/bin/bash

# Ward SDK Test Environment Setup Script
# Sets up the complete Ward observability stack and generates test data

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
TENANT_ID="test-tenant-$(date +%s)"
API_KEY=""
DASHBOARD_URL="http://localhost:3001"
GATEWAY_URL="http://localhost:8080"

print_banner() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════════════════════════╗"
    echo "║                        🚀 Ward SDK Test Environment Setup                        ║"
    echo "║                                                                                  ║"
    echo "║  This script will:                                                              ║"
    echo "║  • Start all Ward services (ClickHouse, OTel Collector, Gateway, Dashboard)    ║"
    echo "║  • Generate test API keys                                                       ║"
    echo "║  • Create sample trace data                                                     ║"
    echo "║  • Open the dashboard for exploration                                           ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

check_dependencies() {
    echo -e "${BLUE}🔍 Checking dependencies...${NC}"

    # Check Docker
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker is not installed. Please install Docker first.${NC}"
        exit 1
    fi

    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        echo -e "${RED}❌ Docker Compose is not available. Please install Docker Compose.${NC}"
        exit 1
    fi

    # Check Python
    if ! command -v python3 &> /dev/null; then
        echo -e "${RED}❌ Python 3 is not installed. Please install Python 3.${NC}"
        exit 1
    fi

    # Check if .env file exists
    if [ ! -f ".env" ] && [ ! -f "dashboard/.env.local" ]; then
        echo -e "${YELLOW}⚠️  No .env files found. Make sure to configure environment variables.${NC}"
        echo "   Copy dashboard/.env.example to dashboard/.env.local and configure:"
        echo "   • OPENAI_API_KEY=your_openai_key"
        echo "   • ANTHROPIC_API_KEY=your_anthropic_key (optional)"
        echo "   • NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY"
    fi

    echo -e "${GREEN}✅ Dependencies check passed${NC}"
}

ensure_collector_auth_token() {
    # The gateway and otel-collector both refuse to start without
    # COLLECTOR_AUTH_TOKEN. In production the operator MUST set it explicitly
    # (it's the second line of defense behind the gateway/collector network
    # boundary — see #25 / `.agents/tenant-isolation-audit.md`). For local dev
    # convenience we generate one if it's not already set.
    if [ -z "${COLLECTOR_AUTH_TOKEN:-}" ]; then
        export COLLECTOR_AUTH_TOKEN="$(openssl rand -hex 32)"
        echo -e "${YELLOW}🔐 COLLECTOR_AUTH_TOKEN was unset — generated a fresh dev token.${NC}"
        echo -e "${YELLOW}   This is DEV ONLY. Production deploys MUST set this explicitly${NC}"
        echo -e "${YELLOW}   in the gateway and otel-collector environments.${NC}"
    else
        echo -e "${GREEN}🔐 COLLECTOR_AUTH_TOKEN already set — using existing value.${NC}"
    fi
}

start_services() {
    echo -e "${BLUE}🐳 Starting Ward services...${NC}"

    # Stop existing containers to avoid conflicts
    docker-compose down 2>/dev/null || true

    # Start all services
    echo -e "${YELLOW}   Starting ClickHouse, OTel Collector, Gateway, Dashboard, Redis, Postgres...${NC}"
    docker-compose up -d

    echo -e "${YELLOW}   Waiting for services to be healthy...${NC}"

    # Wait for ClickHouse
    echo -n "   ClickHouse: "
    for i in {1..30}; do
        if curl -s http://localhost:8123/ping > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Ready${NC}"
            break
        fi
        echo -n "."
        sleep 2
    done

    # Wait for Redis
    echo -n "   Redis: "
    for i in {1..15}; do
        if redis-cli -p 6379 ping > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Ready${NC}"
            break
        elif docker exec redis redis-cli ping > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Ready${NC}"
            break
        fi
        echo -n "."
        sleep 2
    done

    # Wait for Gateway
    echo -n "   Gateway: "
    for i in {1..20}; do
        if curl -s http://localhost:8080/health > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Ready${NC}"
            break
        fi
        echo -n "."
        sleep 3
    done

    # Wait for Dashboard
    echo -n "   Dashboard: "
    for i in {1..30}; do
        if curl -s http://localhost:3001 > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Ready${NC}"
            break
        fi
        echo -n "."
        sleep 2
    done

    echo -e "${GREEN}🎉 All services are running!${NC}"
}

generate_api_key() {
    echo -e "${BLUE}🔑 Generating test API key...${NC}"

    # Check if seed command exists
    if [ ! -f "./gateway/cmd/seed/main.go" ]; then
        echo -e "${YELLOW}⚠️  Seed tool not found. Creating API key manually...${NC}"
        # Generate a test key manually
        API_KEY="ak_live_test_$(openssl rand -hex 16)"
        echo -e "${GREEN}✅ Generated test API key: ${API_KEY}${NC}"
        echo -e "${YELLOW}   Note: This is a mock key. Use the gateway seed tool for production.${NC}"
        return
    fi

    # Build and run the seed tool
    echo -e "${YELLOW}   Building seed tool...${NC}"
    cd gateway && go build -o seed ./cmd/seed && cd ..

    echo -e "${YELLOW}   Generating API key for tenant: ${TENANT_ID}${NC}"
    KEY_OUTPUT=$(./gateway/seed --tenant="${TENANT_ID}" --tier="pro" --rate-limit=10000)

    # Extract the API key from output
    API_KEY=$(echo "$KEY_OUTPUT" | grep -o 'ak_[a-zA-Z0-9_]*' | head -1)

    if [ -n "$API_KEY" ]; then
        echo -e "${GREEN}✅ Generated API key: ${API_KEY}${NC}"
        echo -e "${GREEN}✅ Tenant ID: ${TENANT_ID}${NC}"
    else
        echo -e "${RED}❌ Failed to generate API key${NC}"
        echo "Output: $KEY_OUTPUT"
        API_KEY="${WARD_API_KEY:-}"
        if [ -z "$API_KEY" ]; then
            echo -e "${RED}❌ Seed tool failed and WARD_API_KEY env var is not set. Aborting.${NC}"
            exit 1
        fi
        echo -e "${YELLOW}   Using WARD_API_KEY from env: ${API_KEY:0:11}...${NC}"
    fi
}

install_python_dependencies() {
    echo -e "${BLUE}📦 Installing Python dependencies...${NC}"

    # Check if virtual environment should be used
    if command -v python3 -m venv &> /dev/null; then
        if [ ! -d "venv" ]; then
            echo -e "${YELLOW}   Creating Python virtual environment...${NC}"
            python3 -m venv venv
        fi

        echo -e "${YELLOW}   Activating virtual environment...${NC}"
        source venv/bin/activate
    fi

    # Install required packages
    echo -e "${YELLOW}   Installing packages...${NC}"
    pip install openai anthropic python-dotenv ward-sdk || {
        echo -e "${YELLOW}   Ward SDK not available via pip, using local development version...${NC}"
        pip install -e . || echo -e "${YELLOW}   Continuing without Ward SDK installation...${NC}"
    }

    # Install optional packages
    pip install requests beautifulsoup4 selenium 2>/dev/null || true

    echo -e "${GREEN}✅ Python dependencies installed${NC}"
}

create_env_files() {
    echo -e "${BLUE}📝 Creating environment configuration...${NC}"

    # Create test .env file if it doesn't exist
    if [ ! -f ".env" ]; then
        cat > .env << EOF
# Ward SDK Test Environment Configuration
OPENAI_API_KEY=${OPENAI_API_KEY:-"your_openai_api_key_here"}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-"your_anthropic_api_key_here"}
WARD_API_KEY=${API_KEY}
WARD_TENANT_ID=${TENANT_ID}
WARD_OTLP_ENDPOINT=http://localhost:8080
EOF
        echo -e "${GREEN}✅ Created .env file${NC}"
    fi

    # Test scripts read WARD_API_KEY from .env at runtime — no in-place substitution needed.
}

run_sample_tests() {
    echo -e "${BLUE}🧪 Generating sample test data...${NC}"

    echo -e "${YELLOW}   Running comprehensive workflow tests...${NC}"
    if python3 scripts/test_comprehensive_workflows.py 2>/dev/null; then
        echo -e "${GREEN}✅ Workflow tests completed${NC}"
    else
        echo -e "${YELLOW}⚠️  Workflow tests had issues (API keys may need configuration)${NC}"
    fi

    echo -e "${YELLOW}   Running metrics verification...${NC}"
    if python3 scripts/verify_metrics.py --test-session 2>/dev/null; then
        echo -e "${GREEN}✅ Metrics verification completed${NC}"
    else
        echo -e "${YELLOW}⚠️  Metrics verification had issues${NC}"
    fi

    # Wait a bit for data to be processed
    echo -e "${YELLOW}   Waiting 10s for data to be processed...${NC}"
    sleep 10
}

open_dashboard() {
    echo -e "${BLUE}🌐 Opening Ward dashboard...${NC}"

    # Check if dashboard is accessible
    if curl -s http://localhost:3001 > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Dashboard is accessible at: ${DASHBOARD_URL}${NC}"

        # Try to open in browser
        if command -v open &> /dev/null; then
            open "${DASHBOARD_URL}/traces" 2>/dev/null || true
        elif command -v xdg-open &> /dev/null; then
            xdg-open "${DASHBOARD_URL}/traces" 2>/dev/null || true
        fi
    else
        echo -e "${RED}❌ Dashboard is not accessible${NC}"
    fi
}

print_usage_guide() {
    echo -e "${PURPLE}"
    echo "╔══════════════════════════════════════════════════════════════════════════════════╗"
    echo "║                            🎯 Ward Dashboard Usage Guide                         ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    echo -e "${CYAN}📊 Dashboard URLs:${NC}"
    echo "   • Main Dashboard:  http://localhost:3001"
    echo "   • Traces View:     http://localhost:3001/traces"
    echo "   • Costs View:      http://localhost:3001/costs"
    echo "   • Settings:        http://localhost:3001/settings"
    echo ""

    echo -e "${CYAN}🔧 Generated Configuration:${NC}"
    echo "   • API Key:         ${API_KEY}"
    echo "   • Tenant ID:       ${TENANT_ID}"
    echo "   • Gateway:         http://localhost:8080"
    echo ""

    echo -e "${CYAN}🧪 Test Scripts:${NC}"
    echo "   • Comprehensive tests:     python3 scripts/test_comprehensive_workflows.py"
    echo "   • Generate bulk data:      python3 scripts/generate_test_data.py --sessions 50"
    echo "   • Verify metrics:          python3 scripts/verify_metrics.py --test-session"
    echo "   • Load testing:           python3 scripts/generate_test_data.py --load-test"
    echo ""

    echo -e "${CYAN}🔍 What to Explore in the Dashboard:${NC}"
    echo "   1. Session Table - View grouped conversations with metrics"
    echo "   2. Time Filtering - Try 1h, 24h, 7d ranges"
    echo "   3. Search - Search for keywords in conversations"
    echo "   4. Session Details - Click session IDs to see individual traces"
    echo "   5. Model Filtering - Filter by GPT-4o, GPT-4o-mini, Claude"
    echo "   6. Cost Analysis - Review token usage and costs"
    echo ""

    echo -e "${CYAN}🛠️ Service Management:${NC}"
    echo "   • Stop services:           docker-compose down"
    echo "   • View logs:              docker-compose logs -f [service_name]"
    echo "   • Restart dashboard:      docker-compose restart dashboard"
    echo "   • Reset data:             docker-compose down -v && docker-compose up -d"
    echo ""

    echo -e "${CYAN}📈 Expected Test Data:${NC}"
    echo "   • ~10-15 sessions from comprehensive tests"
    echo "   • Mix of models: GPT-4o, GPT-4o-mini, Claude Sonnet"
    echo "   • Various costs: \$0.0001 - \$0.01 per session"
    echo "   • Different patterns: Support, Code Review, Content Creation"
    echo ""

    echo -e "${GREEN}✨ Environment setup complete! Explore the dashboard at ${DASHBOARD_URL}/traces${NC}"
}

print_troubleshooting() {
    echo -e "${YELLOW}"
    echo "🔧 Troubleshooting Tips:"
    echo "========================"
    echo -e "${NC}"
    echo "1. No traces appearing?"
    echo "   • Check API keys in .env file"
    echo "   • Verify services: docker-compose ps"
    echo "   • Check gateway logs: docker-compose logs gateway"
    echo ""
    echo "2. Dashboard not loading?"
    echo "   • Wait 2-3 minutes for initial build"
    echo "   • Check logs: docker-compose logs dashboard"
    echo "   • Try: docker-compose restart dashboard"
    echo ""
    echo "3. ClickHouse connection errors?"
    echo "   • Check status: curl http://localhost:8123/ping"
    echo "   • Restart: docker-compose restart clickhouse"
    echo ""
    echo "4. Need to reset everything?"
    echo "   • Run: docker-compose down -v"
    echo "   • Then: docker-compose up -d"
    echo ""
}

# Main execution
main() {
    print_banner

    # Parse command line arguments
    SKIP_TESTS=false
    SKIP_DATA_GEN=false
    HELP=false

    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            --skip-data)
                SKIP_DATA_GEN=true
                shift
                ;;
            --help|-h)
                HELP=true
                shift
                ;;
            *)
                echo -e "${RED}Unknown option: $1${NC}"
                exit 1
                ;;
        esac
    done

    if [ "$HELP" = true ]; then
        echo "Usage: $0 [options]"
        echo "Options:"
        echo "  --skip-tests    Skip running test scripts"
        echo "  --skip-data     Skip generating sample data"
        echo "  --help, -h      Show this help message"
        exit 0
    fi

    # Run setup steps
    check_dependencies
    ensure_collector_auth_token
    start_services
    generate_api_key
    install_python_dependencies
    create_env_files

    if [ "$SKIP_TESTS" = false ] && [ "$SKIP_DATA_GEN" = false ]; then
        run_sample_tests
    fi

    open_dashboard
    print_usage_guide

    if [ "$SKIP_TESTS" = true ] || [ "$SKIP_DATA_GEN" = true ]; then
        echo -e "${YELLOW}⚠️  Skipped test data generation. Run test scripts manually to populate the dashboard.${NC}"
    fi

    print_troubleshooting
}

# Run main function
main "$@"