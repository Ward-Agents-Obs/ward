#!/usr/bin/env python3
"""
Ward SDK Metrics Verification Script

Validates that the Ward SDK is correctly tracking and the dashboard is accurately
displaying all metrics including:
- Session grouping and continuity
- Token counting (input + output)
- Cost calculations
- Duration measurements
- Message content extraction
- Model attribution
- Error handling

Usage:
    python verify_metrics.py --test-session  # Run test and verify immediately
    python verify_metrics.py --validate-existing  # Check existing data in dashboard
"""

import ward
import time
import argparse
import requests
import json
from datetime import datetime, timedelta
from openai import OpenAI
from anthropic import Anthropic
from dotenv import get_key, find_dotenv, load_dotenv

# Load environment
load_dotenv()

# Initialize clients
openai_client = OpenAI(api_key=get_key(find_dotenv(), "OPENAI_API_KEY"))
anthropic_client = Anthropic(api_key=get_key(find_dotenv(), "ANTHROPIC_API_KEY"))

# Ward SDK with tracking
ward.init(
    application_name="ward-metrics-verification",
    environment="testing",
    otlp_endpoint="http://localhost:8080",
    otlp_headers={"Authorization": "Bearer ak_live_be098ecd94b91e6722c3d36452a5da96"},
    capture_message_content=True,
)

# Expected pricing (per 1M tokens)
PRICING = {
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "claude-sonnet-4-20250514": {"input": 3.00, "output": 15.00},
}

class MetricsVerifier:
    def __init__(self):
        self.test_results = []
        self.verification_results = []

    def calculate_expected_cost(self, model, input_tokens, output_tokens):
        """Calculate expected cost based on pricing table."""
        if model not in PRICING:
            return None

        input_cost = (input_tokens * PRICING[model]["input"]) / 1_000_000
        output_cost = (output_tokens * PRICING[model]["output"]) / 1_000_000
        total_cost = input_cost + output_cost

        return round(total_cost, 6)

    def run_controlled_test_session(self):
        """Run a controlled test session with known expected outcomes."""
        print("\n" + "="*80)
        print("🧪 CONTROLLED TEST SESSION")
        print("="*80)

        test_start_time = time.time()

        with ward.SessionContext() as session_id:
            print(f"📝 Session ID: {session_id}")
            print(f"🕐 Start time: {datetime.now().isoformat()}")

            session_data = {
                "session_id": session_id,
                "start_time": datetime.now(),
                "traces": [],
                "expected_metrics": {}
            }

            # Test 1: Simple question with GPT-4o-mini (predictable token usage)
            print(f"\n🔸 Test 1: Simple math question (GPT-4o-mini)")
            trace_start = time.time()

            response1 = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": "What is 15 + 27?"}],
                max_tokens=50  # Limit to make response predictable
            )

            trace1_duration = (time.time() - trace_start) * 1000  # Convert to ms

            trace1_data = {
                "model": "gpt-4o-mini",
                "user_message": "What is 15 + 27?",
                "response": response1.choices[0].message.content,
                "input_tokens": response1.usage.prompt_tokens,
                "output_tokens": response1.usage.completion_tokens,
                "total_tokens": response1.usage.total_tokens,
                "duration_ms": trace1_duration,
                "expected_cost": self.calculate_expected_cost("gpt-4o-mini",
                                                             response1.usage.prompt_tokens,
                                                             response1.usage.completion_tokens)
            }

            session_data["traces"].append(trace1_data)
            print(f"   Input tokens: {trace1_data['input_tokens']}")
            print(f"   Output tokens: {trace1_data['output_tokens']}")
            print(f"   Expected cost: ${trace1_data['expected_cost']:.6f}")
            print(f"   Response: {trace1_data['response']}")

            time.sleep(2)  # Predictable delay

            # Test 2: More complex question with GPT-4o (higher cost)
            print(f"\n🔸 Test 2: Complex explanation (GPT-4o)")
            trace_start = time.time()

            response2 = openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": "Explain quantum computing in exactly 100 words."}],
                max_tokens=150
            )

            trace2_duration = (time.time() - trace_start) * 1000

            trace2_data = {
                "model": "gpt-4o",
                "user_message": "Explain quantum computing in exactly 100 words.",
                "response": response2.choices[0].message.content,
                "input_tokens": response2.usage.prompt_tokens,
                "output_tokens": response2.usage.completion_tokens,
                "total_tokens": response2.usage.total_tokens,
                "duration_ms": trace2_duration,
                "expected_cost": self.calculate_expected_cost("gpt-4o",
                                                             response2.usage.prompt_tokens,
                                                             response2.usage.completion_tokens)
            }

            session_data["traces"].append(trace2_data)
            print(f"   Input tokens: {trace2_data['input_tokens']}")
            print(f"   Output tokens: {trace2_data['output_tokens']}")
            print(f"   Expected cost: ${trace2_data['expected_cost']:.6f}")
            print(f"   Response: {trace2_data['response'][:100]}...")

            time.sleep(2)

            # Test 3: Claude interaction for model diversity
            print(f"\n🔸 Test 3: Claude interaction (different provider)")
            trace_start = time.time()

            response3 = anthropic_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=100,
                messages=[{"role": "user", "content": "List 5 benefits of renewable energy."}]
            )

            trace3_duration = (time.time() - trace_start) * 1000

            trace3_data = {
                "model": "claude-sonnet-4-20250514",
                "user_message": "List 5 benefits of renewable energy.",
                "response": response3.content[0].text,
                "input_tokens": response3.usage.input_tokens,
                "output_tokens": response3.usage.output_tokens,
                "total_tokens": response3.usage.input_tokens + response3.usage.output_tokens,
                "duration_ms": trace3_duration,
                "expected_cost": self.calculate_expected_cost("claude-sonnet-4-20250514",
                                                             response3.usage.input_tokens,
                                                             response3.usage.output_tokens)
            }

            session_data["traces"].append(trace3_data)
            print(f"   Input tokens: {trace3_data['input_tokens']}")
            print(f"   Output tokens: {trace3_data['output_tokens']}")
            print(f"   Expected cost: ${trace3_data['expected_cost']:.6f}")
            print(f"   Response: {trace3_data['response'][:100]}...")

            # Calculate session-level expected metrics
            session_data["end_time"] = datetime.now()
            total_duration = (time.time() - test_start_time) * 1000

            session_data["expected_metrics"] = {
                "session_id": session_id,
                "first_message": session_data["traces"][0]["user_message"],
                "last_message": session_data["traces"][-1]["response"][:100],
                "total_duration_ms": total_duration,
                "trace_count": len(session_data["traces"]),
                "total_input_tokens": sum(t["input_tokens"] for t in session_data["traces"]),
                "total_output_tokens": sum(t["output_tokens"] for t in session_data["traces"]),
                "total_tokens": sum(t["total_tokens"] for t in session_data["traces"]),
                "total_expected_cost": sum(t["expected_cost"] for t in session_data["traces"]),
                "models_used": list(set(t["model"] for t in session_data["traces"])),
            }

            print(f"\n📊 SESSION SUMMARY:")
            print(f"   Session ID: {session_id[:12]}...")
            print(f"   Duration: {total_duration:.0f}ms ({total_duration/1000:.1f}s)")
            print(f"   Traces: {session_data['expected_metrics']['trace_count']}")
            print(f"   Total tokens: {session_data['expected_metrics']['total_tokens']}")
            print(f"   Expected cost: ${session_data['expected_metrics']['total_expected_cost']:.6f}")
            print(f"   Models: {', '.join(session_data['expected_metrics']['models_used'])}")

            self.test_results.append(session_data)

    def verify_dashboard_data(self, wait_time=30):
        """Verify that the dashboard shows correct metrics for our test session."""
        print(f"\n⏳ Waiting {wait_time}s for data to appear in dashboard...")
        time.sleep(wait_time)

        print("\n" + "="*80)
        print("🔍 DASHBOARD VERIFICATION")
        print("="*80)

        if not self.test_results:
            print("❌ No test results to verify. Run controlled test session first.")
            return

        test_session = self.test_results[0]
        expected = test_session["expected_metrics"]

        print(f"🎯 Looking for session: {expected['session_id'][:12]}...")

        # In a real implementation, you would query the dashboard API or ClickHouse directly
        # For now, we'll provide instructions for manual verification

        print(f"\n📋 MANUAL VERIFICATION CHECKLIST:")
        print(f"   1. Navigate to: http://localhost:3001/traces")
        print(f"   2. Look for session starting with: {expected['session_id'][:12]}")
        print(f"   3. Verify the following metrics:")

        print(f"\n   ✓ Session Table Columns:")
        print(f"     • Session ID: {expected['session_id'][:16]}...")
        print(f"     • First Message: '{expected['first_message'][:50]}...'")
        print(f"     • Last Message: '{expected['last_message'][:50]}...'")
        print(f"     • Duration: ~{expected['total_duration_ms']/1000:.1f}s")
        print(f"     • Traces: {expected['trace_count']}")
        print(f"     • Tokens: {expected['total_tokens']:,}")
        print(f"     • Cost: ~${expected['total_expected_cost']:.6f}")

        print(f"\n   ✓ Click Session ID to view details:")
        print(f"     • Should show {expected['trace_count']} spans")
        print(f"     • Models: {', '.join(expected['models_used'])}")
        print(f"     • Individual token counts should match:")

        for i, trace in enumerate(test_session["traces"], 1):
            print(f"       {i}. {trace['model']}: {trace['input_tokens']} → {trace['output_tokens']} tokens (${trace['expected_cost']:.6f})")

        print(f"\n   ✓ Filtering Tests:")
        print(f"     • Search for 'quantum' should find this session")
        print(f"     • Filter by 'gpt-4o' should include this session")
        print(f"     • Filter by 'claude' should include this session")
        print(f"     • Time range '1h' should include this session")

        # Automated verification (if dashboard API was available)
        # This is where you'd add actual API calls to verify data

        return self.create_verification_report(test_session)

    def create_verification_report(self, test_session):
        """Create a detailed verification report."""
        report = {
            "test_timestamp": datetime.now().isoformat(),
            "session_id": test_session["session_id"],
            "expected_metrics": test_session["expected_metrics"],
            "verification_status": "manual_required",
            "checklist": {
                "session_appears_in_table": "pending",
                "session_id_correct": "pending",
                "first_message_correct": "pending",
                "last_message_correct": "pending",
                "duration_reasonable": "pending",
                "trace_count_correct": "pending",
                "token_count_correct": "pending",
                "cost_calculation_correct": "pending",
                "session_detail_accessible": "pending",
                "individual_spans_correct": "pending",
                "model_attribution_correct": "pending",
                "search_functionality": "pending",
                "filtering_works": "pending"
            }
        }

        # Save report to file
        report_filename = f"metrics_verification_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(report_filename, 'w') as f:
            json.dump(report, f, indent=2, default=str)

        print(f"\n💾 Verification report saved: {report_filename}")
        return report

    def test_error_handling(self):
        """Test that errors are properly tracked and displayed."""
        print("\n" + "="*80)
        print("🚨 ERROR HANDLING VERIFICATION")
        print("="*80)

        with ward.SessionContext() as session_id:
            print(f"📝 Error test session: {session_id[:12]}...")

            # Test 1: Invalid model (should create error span)
            print(f"\n🔸 Testing invalid model error tracking...")
            try:
                response = openai_client.chat.completions.create(
                    model="invalid-model-name",
                    messages=[{"role": "user", "content": "This should fail"}]
                )
            except Exception as e:
                print(f"   Expected error: {type(e).__name__}: {str(e)[:100]}...")

            time.sleep(1)

            # Test 2: Recovery call (should succeed)
            print(f"\n🔸 Testing recovery after error...")
            try:
                response = openai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": "This should work after the error."}]
                )
                print(f"   Recovery successful: {response.choices[0].message.content[:50]}...")
            except Exception as e:
                print(f"   Unexpected error during recovery: {e}")

            print(f"\n📋 Error Verification Checklist:")
            print(f"   1. Session {session_id[:12]}... should appear in dashboard")
            print(f"   2. Should show 2 traces (1 error, 1 success)")
            print(f"   3. Error trace should have error status/message")
            print(f"   4. Success trace should have normal metrics")
            print(f"   5. Session should still calculate valid duration/cost")

    def run_streaming_test(self):
        """Test streaming response handling."""
        print("\n" + "="*80)
        print("🌊 STREAMING RESPONSE TEST")
        print("="*80)

        with ward.SessionContext() as session_id:
            print(f"📝 Streaming test session: {session_id[:12]}...")

            print(f"\n🔸 Testing streaming response...")
            start_time = time.time()

            stream = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": "Count from 1 to 10 with a brief explanation for each number."}],
                stream=True
            )

            response_chunks = []
            print("   Streaming: ", end="", flush=True)

            for chunk in stream:
                if chunk.choices[0].delta.content is not None:
                    content = chunk.choices[0].delta.content
                    response_chunks.append(content)
                    print(content, end="", flush=True)

            print("")
            streaming_duration = time.time() - start_time

            print(f"\n📊 Streaming test completed:")
            print(f"   Duration: {streaming_duration:.2f}s")
            print(f"   Chunks received: {len(response_chunks)}")
            print(f"   Total content length: {sum(len(chunk) for chunk in response_chunks)} chars")

            print(f"\n📋 Streaming Verification Checklist:")
            print(f"   1. Session {session_id[:12]}... should appear in dashboard")
            print(f"   2. Should show 1 trace for the streaming call")
            print(f"   3. Token usage should be calculated correctly")
            print(f"   4. Duration should reflect total streaming time (~{streaming_duration:.1f}s)")
            print(f"   5. Response content should be captured properly")

def main():
    parser = argparse.ArgumentParser(description="Verify Ward SDK metrics accuracy")
    parser.add_argument("--test-session", action="store_true", help="Run controlled test session")
    parser.add_argument("--validate-existing", action="store_true", help="Validate existing dashboard data")
    parser.add_argument("--test-errors", action="store_true", help="Test error handling")
    parser.add_argument("--test-streaming", action="store_true", help="Test streaming responses")
    parser.add_argument("--wait-time", type=int, default=30, help="Wait time for data to appear (seconds)")

    args = parser.parse_args()

    verifier = MetricsVerifier()

    print("🔬 Ward SDK Metrics Verification")
    print("=" * 80)
    print("This script validates that Ward SDK correctly tracks metrics")
    print("and the dashboard displays them accurately.")
    print("=" * 80)

    if args.test_session or not any([args.validate_existing, args.test_errors, args.test_streaming]):
        verifier.run_controlled_test_session()
        verifier.verify_dashboard_data(args.wait_time)

    if args.test_errors:
        verifier.test_error_handling()

    if args.test_streaming:
        verifier.run_streaming_test()

    if args.validate_existing:
        print("\n🔍 EXISTING DATA VALIDATION")
        print("=" * 40)
        print("Navigate to http://localhost:3001/traces and verify:")
        print("• Sessions are grouped correctly")
        print("• Token counts add up properly")
        print("• Cost calculations match expected pricing")
        print("• Durations are reasonable")
        print("• First/last messages are extracted correctly")
        print("• Search and filtering work properly")

    print(f"\n✅ Verification complete!")
    print(f"📊 Dashboard: http://localhost:3001/traces")
    print(f"💾 Check verification report files for detailed results")

if __name__ == "__main__":
    main()