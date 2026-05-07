#!/usr/bin/env python3
"""
Ward SDK Load Testing Script

Tests the Ward observability system under various load conditions to ensure:
- Dashboard performance with large datasets
- Session grouping accuracy at scale
- Cost calculation precision with high volume
- Search and filtering performance
- Real-time data ingestion

Usage:
    python load_test.py --light     # 100 sessions, 500 traces
    python load_test.py --medium    # 500 sessions, 2500 traces
    python load_test.py --heavy     # 1000 sessions, 10000 traces
    python load_test.py --custom --sessions 250 --traces-per-session 5
"""

import ward
import time
import random
import asyncio
import argparse
import threading
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from openai import OpenAI, AsyncOpenAI
from anthropic import Anthropic, AsyncAnthropic
from dotenv import get_key, find_dotenv, load_dotenv

# Load environment
load_dotenv()

# Initialize clients
openai_client = OpenAI(api_key=get_key(find_dotenv(), "OPENAI_API_KEY"))
anthropic_client = Anthropic(api_key=get_key(find_dotenv(), "ANTHROPIC_API_KEY"))

async_openai_client = AsyncOpenAI(api_key=get_key(find_dotenv(), "OPENAI_API_KEY"))
async_anthropic_client = AsyncAnthropic(api_key=get_key(find_dotenv(), "ANTHROPIC_API_KEY"))

# Initialize Ward SDK
ward.init(
    application_name="ward-load-testing",
    environment="load-test",
    otlp_endpoint="http://localhost:8080",
    otlp_headers={"Authorization": f"Bearer {get_key(find_dotenv(), 'WARD_API_KEY')}"},
    capture_message_content=True,
)

class LoadTestMetrics:
    def __init__(self):
        self.sessions_created = 0
        self.traces_created = 0
        self.total_tokens = 0
        self.total_cost = 0
        self.errors = 0
        self.start_time = None
        self.end_time = None
        self.response_times = []
        self.models_used = {}
        self.lock = threading.Lock()

    def record_interaction(self, tokens, cost, response_time_ms, model, error=False):
        with self.lock:
            if error:
                self.errors += 1
            else:
                self.traces_created += 1
                self.total_tokens += tokens
                self.total_cost += cost
                self.response_times.append(response_time_ms)
                self.models_used[model] = self.models_used.get(model, 0) + 1

    def record_session(self):
        with self.lock:
            self.sessions_created += 1

    def get_stats(self):
        with self.lock:
            if not self.response_times:
                return {}

            duration = (self.end_time - self.start_time).total_seconds() if self.end_time and self.start_time else 0

            return {
                "duration_seconds": duration,
                "sessions_created": self.sessions_created,
                "traces_created": self.traces_created,
                "total_tokens": self.total_tokens,
                "total_cost": self.total_cost,
                "errors": self.errors,
                "avg_response_time_ms": sum(self.response_times) / len(self.response_times),
                "p95_response_time_ms": sorted(self.response_times)[int(0.95 * len(self.response_times))],
                "p99_response_time_ms": sorted(self.response_times)[int(0.99 * len(self.response_times))],
                "traces_per_second": self.traces_created / duration if duration > 0 else 0,
                "sessions_per_second": self.sessions_created / duration if duration > 0 else 0,
                "models_distribution": self.models_used
            }

class LoadTestRunner:
    def __init__(self):
        self.metrics = LoadTestMetrics()
        self.models = ["gpt-4o-mini", "gpt-4o", "claude-sonnet-4-20250514"]
        self.model_weights = [0.7, 0.2, 0.1]  # Favor cheaper models in load testing

        # Template messages for different conversation types
        self.message_templates = {
            "quick_queries": [
                "What's the weather like today?",
                "Convert 100 USD to EUR",
                "What time is it in Tokyo?",
                "Define artificial intelligence",
                "How do I reset my password?",
                "What's the capital of France?",
                "Explain photosynthesis briefly",
                "What's 15 * 23?",
                "How do I cook pasta?",
                "What's the fastest animal?"
            ],
            "support_queries": [
                "I'm having trouble logging into my account",
                "My subscription was charged twice this month",
                "How do I upgrade my plan?",
                "I need help with API rate limits",
                "Can you explain your refund policy?",
                "I'm getting error 404 on your website",
                "How do I export my data?",
                "My payment method was declined",
                "I want to cancel my subscription",
                "How do I change my billing address?"
            ],
            "technical_queries": [
                "How do I implement OAuth 2.0?",
                "Explain Docker containers",
                "What's the difference between SQL and NoSQL?",
                "How do I debug memory leaks?",
                "Best practices for API design",
                "How to optimize database queries?",
                "Explain microservices architecture",
                "What is continuous integration?",
                "How to handle errors in JavaScript?",
                "What's the difference between Git and GitHub?"
            ],
            "content_queries": [
                "Write a product description for a smartwatch",
                "Create a social media post about sustainability",
                "Draft an email for a product launch",
                "Write a blog post outline about AI",
                "Create a marketing headline",
                "Write a press release template",
                "Generate ideas for a newsletter",
                "Create ad copy for a mobile app",
                "Write a customer testimonial",
                "Draft a company announcement"
            ]
        }

    def calculate_cost(self, model, input_tokens, output_tokens):
        """Calculate cost based on model pricing."""
        pricing = {
            "gpt-4o": {"input": 2.50, "output": 10.00},
            "gpt-4o-mini": {"input": 0.15, "output": 0.60},
            "claude-sonnet-4-20250514": {"input": 3.00, "output": 15.00},
        }

        if model not in pricing:
            return 0

        input_cost = (input_tokens * pricing[model]["input"]) / 1_000_000
        output_cost = (output_tokens * pricing[model]["output"]) / 1_000_000
        return input_cost + output_cost

    def select_model(self):
        """Select model based on weighted distribution."""
        return random.choices(self.models, weights=self.model_weights, k=1)[0]

    def select_conversation_type(self):
        """Select conversation type with realistic distribution."""
        types = list(self.message_templates.keys())
        weights = [0.4, 0.3, 0.2, 0.1]  # Favor quick queries for load testing
        return random.choices(types, weights=weights, k=1)[0]

    def generate_session(self, session_id, traces_per_session):
        """Generate a single session with multiple traces."""
        try:
            conversation_type = self.select_conversation_type()
            messages = random.sample(self.message_templates[conversation_type],
                                   min(traces_per_session, len(self.message_templates[conversation_type])))

            with ward.SessionContext() as ward_session_id:
                for i, message in enumerate(messages):
                    try:
                        model = self.select_model()
                        start_time = time.time()

                        if model.startswith("claude"):
                            response = anthropic_client.messages.create(
                                model=model,
                                max_tokens=random.randint(50, 200),  # Vary response length
                                messages=[{"role": "user", "content": message}]
                            )

                            tokens = response.usage.input_tokens + response.usage.output_tokens
                            cost = self.calculate_cost(model, response.usage.input_tokens, response.usage.output_tokens)

                        else:
                            response = openai_client.chat.completions.create(
                                model=model,
                                messages=[{"role": "user", "content": message}],
                                max_tokens=random.randint(50, 200)
                            )

                            tokens = response.usage.total_tokens
                            cost = self.calculate_cost(model, response.usage.prompt_tokens, response.usage.completion_tokens)

                        response_time = (time.time() - start_time) * 1000

                        self.metrics.record_interaction(tokens, cost, response_time, model)

                        # Small random delay between traces in same session
                        if i < len(messages) - 1:
                            time.sleep(random.uniform(0.1, 0.5))

                    except Exception as e:
                        self.metrics.record_interaction(0, 0, 0, model, error=True)
                        print(f"Error in trace {i+1} of session {session_id}: {e}")

                self.metrics.record_session()

        except Exception as e:
            print(f"Error in session {session_id}: {e}")

    async def generate_async_session(self, session_id, traces_per_session):
        """Generate a session using async clients for better concurrency."""
        try:
            conversation_type = self.select_conversation_type()
            messages = random.sample(self.message_templates[conversation_type],
                                   min(traces_per_session, len(self.message_templates[conversation_type])))

            with ward.SessionContext() as ward_session_id:
                for i, message in enumerate(messages):
                    try:
                        model = self.select_model()
                        start_time = time.time()

                        if model.startswith("claude"):
                            response = await async_anthropic_client.messages.create(
                                model=model,
                                max_tokens=random.randint(50, 200),
                                messages=[{"role": "user", "content": message}]
                            )

                            tokens = response.usage.input_tokens + response.usage.output_tokens
                            cost = self.calculate_cost(model, response.usage.input_tokens, response.usage.output_tokens)

                        else:
                            response = await async_openai_client.chat.completions.create(
                                model=model,
                                messages=[{"role": "user", "content": message}],
                                max_tokens=random.randint(50, 200)
                            )

                            tokens = response.usage.total_tokens
                            cost = self.calculate_cost(model, response.usage.prompt_tokens, response.usage.completion_tokens)

                        response_time = (time.time() - start_time) * 1000

                        self.metrics.record_interaction(tokens, cost, response_time, model)

                        # Small random delay between traces in same session
                        if i < len(messages) - 1:
                            await asyncio.sleep(random.uniform(0.05, 0.2))

                    except Exception as e:
                        self.metrics.record_interaction(0, 0, 0, model, error=True)
                        print(f"Error in async trace {i+1} of session {session_id}: {e}")

                self.metrics.record_session()

        except Exception as e:
            print(f"Error in async session {session_id}: {e}")

    def run_threaded_load_test(self, num_sessions, traces_per_session, max_workers=50):
        """Run load test using thread pool for concurrency."""
        print(f"\n🔥 THREADED LOAD TEST")
        print(f"   Sessions: {num_sessions}")
        print(f"   Traces per session: {traces_per_session}")
        print(f"   Max workers: {max_workers}")
        print(f"   Expected total traces: {num_sessions * traces_per_session}")

        self.metrics.start_time = datetime.now()

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all sessions to thread pool
            futures = []
            for session_id in range(num_sessions):
                future = executor.submit(self.generate_session, session_id, traces_per_session)
                futures.append(future)

            # Monitor progress
            completed = 0
            for future in as_completed(futures):
                completed += 1
                if completed % 10 == 0 or completed == num_sessions:
                    print(f"   Progress: {completed}/{num_sessions} sessions ({completed/num_sessions*100:.1f}%)")

        self.metrics.end_time = datetime.now()

    async def run_async_load_test(self, num_sessions, traces_per_session, concurrency_limit=100):
        """Run load test using async clients for better performance."""
        print(f"\n⚡ ASYNC LOAD TEST")
        print(f"   Sessions: {num_sessions}")
        print(f"   Traces per session: {traces_per_session}")
        print(f"   Concurrency limit: {concurrency_limit}")
        print(f"   Expected total traces: {num_sessions * traces_per_session}")

        self.metrics.start_time = datetime.now()

        # Create semaphore to limit concurrency
        semaphore = asyncio.Semaphore(concurrency_limit)

        async def bounded_session(session_id):
            async with semaphore:
                await self.generate_async_session(session_id, traces_per_session)

        # Create all session tasks
        tasks = [bounded_session(session_id) for session_id in range(num_sessions)]

        # Run with progress monitoring
        completed = 0
        for task in asyncio.as_completed(tasks):
            await task
            completed += 1
            if completed % 10 == 0 or completed == num_sessions:
                print(f"   Progress: {completed}/{num_sessions} sessions ({completed/num_sessions*100:.1f}%)")

        self.metrics.end_time = datetime.now()

    def run_burst_pattern_test(self, num_bursts, sessions_per_burst, traces_per_session):
        """Run load test with burst patterns to simulate real-world traffic."""
        print(f"\n💥 BURST PATTERN TEST")
        print(f"   Bursts: {num_bursts}")
        print(f"   Sessions per burst: {sessions_per_burst}")
        print(f"   Traces per session: {traces_per_session}")

        self.metrics.start_time = datetime.now()

        for burst in range(num_bursts):
            print(f"\n   Burst {burst + 1}/{num_bursts}")

            # Run burst of concurrent sessions
            with ThreadPoolExecutor(max_workers=sessions_per_burst) as executor:
                futures = []
                for session_id in range(sessions_per_burst):
                    future = executor.submit(self.generate_session,
                                           f"{burst}_{session_id}", traces_per_session)
                    futures.append(future)

                # Wait for burst to complete
                for future in as_completed(futures):
                    future.result()  # Get result to handle any exceptions

            # Random quiet period between bursts
            if burst < num_bursts - 1:
                quiet_time = random.uniform(2, 5)
                print(f"   Quiet period: {quiet_time:.1f}s")
                time.sleep(quiet_time)

        self.metrics.end_time = datetime.now()

    def print_results(self):
        """Print comprehensive load test results."""
        stats = self.metrics.get_stats()

        print(f"\n{'='*80}")
        print(f"📊 LOAD TEST RESULTS")
        print(f"{'='*80}")

        print(f"\n⏱️  PERFORMANCE METRICS:")
        print(f"   Duration: {stats['duration_seconds']:.1f} seconds")
        print(f"   Sessions created: {stats['sessions_created']:,}")
        print(f"   Traces created: {stats['traces_created']:,}")
        print(f"   Errors: {stats['errors']}")
        print(f"   Success rate: {(1 - stats['errors']/max(stats['traces_created'] + stats['errors'], 1))*100:.1f}%")

        print(f"\n⚡ THROUGHPUT METRICS:")
        print(f"   Sessions/second: {stats['sessions_per_second']:.2f}")
        print(f"   Traces/second: {stats['traces_per_second']:.2f}")
        print(f"   Avg response time: {stats['avg_response_time_ms']:.0f}ms")
        print(f"   P95 response time: {stats['p95_response_time_ms']:.0f}ms")
        print(f"   P99 response time: {stats['p99_response_time_ms']:.0f}ms")

        print(f"\n💰 COST METRICS:")
        print(f"   Total tokens: {stats['total_tokens']:,}")
        print(f"   Total cost: ${stats['total_cost']:.4f}")
        print(f"   Avg cost per trace: ${stats['total_cost']/max(stats['traces_created'], 1):.6f}")
        print(f"   Avg tokens per trace: {stats['total_tokens']/max(stats['traces_created'], 1):.0f}")

        print(f"\n🤖 MODEL DISTRIBUTION:")
        total_traces = sum(stats['models_distribution'].values())
        for model, count in sorted(stats['models_distribution'].items()):
            percentage = (count / total_traces) * 100
            print(f"   {model}: {count:,} ({percentage:.1f}%)")

        print(f"\n🎯 DASHBOARD VERIFICATION:")
        print(f"   • Navigate to: http://localhost:3001/traces")
        print(f"   • Expected sessions: {stats['sessions_created']:,}")
        print(f"   • Expected traces: {stats['traces_created']:,}")
        print(f"   • Expected cost range: ${stats['total_cost']:.4f}")
        print(f"   • Time range: Last {stats['duration_seconds']/60:.0f} minutes")

        print(f"\n🔍 PERFORMANCE EXPECTATIONS:")
        if stats['traces_per_second'] > 5:
            print(f"   ✅ High throughput: {stats['traces_per_second']:.1f} traces/sec")
        elif stats['traces_per_second'] > 2:
            print(f"   ⚠️  Medium throughput: {stats['traces_per_second']:.1f} traces/sec")
        else:
            print(f"   ❌ Low throughput: {stats['traces_per_second']:.1f} traces/sec")

        if stats['p95_response_time_ms'] < 2000:
            print(f"   ✅ Good response times: P95 {stats['p95_response_time_ms']:.0f}ms")
        else:
            print(f"   ⚠️  Slow response times: P95 {stats['p95_response_time_ms']:.0f}ms")

        if stats['errors'] == 0:
            print(f"   ✅ No errors")
        else:
            print(f"   ⚠️  {stats['errors']} errors occurred")

def main():
    parser = argparse.ArgumentParser(description="Ward SDK Load Testing")
    parser.add_argument("--light", action="store_true", help="Light load: 100 sessions, 500 traces")
    parser.add_argument("--medium", action="store_true", help="Medium load: 500 sessions, 2500 traces")
    parser.add_argument("--heavy", action="store_true", help="Heavy load: 1000 sessions, 10000 traces")
    parser.add_argument("--custom", action="store_true", help="Custom load test")
    parser.add_argument("--sessions", type=int, default=50, help="Number of sessions (custom mode)")
    parser.add_argument("--traces-per-session", type=int, default=3, help="Traces per session (custom mode)")
    parser.add_argument("--async-mode", action="store_true", help="Use async clients for better performance")
    parser.add_argument("--burst-mode", action="store_true", help="Use burst pattern (realistic traffic)")
    parser.add_argument("--max-workers", type=int, default=50, help="Max concurrent workers")

    args = parser.parse_args()

    runner = LoadTestRunner()

    print("🔥 Ward SDK Load Testing")
    print("=" * 80)
    print("Testing Ward observability system performance under load")
    print("=" * 80)

    # Determine test parameters
    if args.light:
        num_sessions, traces_per_session = 100, 5
        test_name = "LIGHT LOAD"
    elif args.medium:
        num_sessions, traces_per_session = 500, 5
        test_name = "MEDIUM LOAD"
    elif args.heavy:
        num_sessions, traces_per_session = 1000, 10
        test_name = "HEAVY LOAD"
    else:
        num_sessions, traces_per_session = args.sessions, args.traces_per_session
        test_name = "CUSTOM LOAD"

    print(f"🎯 Test Profile: {test_name}")
    print(f"   Sessions: {num_sessions:,}")
    print(f"   Traces per session: {traces_per_session}")
    print(f"   Expected total traces: {num_sessions * traces_per_session:,}")
    print(f"   Mode: {'Async' if args.async_mode else 'Threaded'}")

    try:
        if args.burst_mode:
            # Burst pattern: multiple bursts with quiet periods
            num_bursts = max(1, num_sessions // 50)  # 50 sessions per burst
            sessions_per_burst = num_sessions // num_bursts
            runner.run_burst_pattern_test(num_bursts, sessions_per_burst, traces_per_session)
        elif args.async_mode:
            asyncio.run(runner.run_async_load_test(num_sessions, traces_per_session, args.max_workers))
        else:
            runner.run_threaded_load_test(num_sessions, traces_per_session, args.max_workers)

        runner.print_results()

    except KeyboardInterrupt:
        print(f"\n⚠️  Load test interrupted by user")
        runner.metrics.end_time = datetime.now()
        runner.print_results()
    except Exception as e:
        print(f"\n❌ Load test failed: {e}")

if __name__ == "__main__":
    main()