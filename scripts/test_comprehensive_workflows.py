#!/usr/bin/env python3
"""
Comprehensive Ward SDK Test Suite - Realistic User Workflows

This script demonstrates various real-world scenarios using the Ward SDK with session tracking.
It generates realistic conversations and workflows that will be visible in the traces dashboard.

Run with: python test_comprehensive_workflows.py
Then navigate to http://localhost:3001/traces to see results in the dashboard.
"""

import ward
import time
import asyncio
import random
from openai import OpenAI, AsyncOpenAI
from anthropic import Anthropic, AsyncAnthropic
from dotenv import get_key, find_dotenv, load_dotenv
from datetime import datetime

# Load environment variables
load_dotenv()

# Initialize clients
openai_client = OpenAI(api_key=get_key(find_dotenv(), "OPENAI_API_KEY"))
anthropic_client = Anthropic(api_key=get_key(find_dotenv(), "ANTHROPIC_API_KEY"))

async_openai_client = AsyncOpenAI(api_key=get_key(find_dotenv(), "OPENAI_API_KEY"))
async_anthropic_client = AsyncAnthropic(api_key=get_key(find_dotenv(), "ANTHROPIC_API_KEY"))

# Initialize Ward SDK
ward.init(
    application_name="ward-test-workflows",
    environment="testing",
    otlp_endpoint="http://localhost:8080",
    otlp_headers={"Authorization": "Bearer ak_live_be098ecd94b91e6722c3d36452a5da96"},
    capture_message_content=True,
)

def log_session_info(session_name, session_id, step, details=""):
    """Helper to log session information for dashboard verification."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {session_name} | Session: {session_id[:12]}... | {step} {details}")

def simulate_customer_support_workflow():
    """
    Scenario: E-commerce customer support chatbot
    - Customer asks about product availability
    - Asks about shipping
    - Requests return policy
    - Gets final help with order placement
    """
    print("\n" + "="*80)
    print("🛒 CUSTOMER SUPPORT WORKFLOW")
    print("="*80)

    with ward.SessionContext() as session_id:
        log_session_info("Customer Support", session_id, "START", "- E-commerce support conversation")

        # Step 1: Product inquiry
        log_session_info("Customer Support", session_id, "STEP 1", "- Product availability check")
        response1 = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a helpful e-commerce customer support agent. Be concise and friendly."},
                {"role": "user", "content": "Hi! Do you have the iPhone 15 Pro in blue available? I'm looking for 256GB storage."}
            ]
        )
        print(f"Agent: {response1.choices[0].message.content}\n")
        time.sleep(1)

        # Step 2: Shipping inquiry
        log_session_info("Customer Support", session_id, "STEP 2", "- Shipping options check")
        response2 = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a helpful e-commerce customer support agent. Be concise and friendly."},
                {"role": "user", "content": "Great! What are my shipping options and how long would it take to get to California?"}
            ]
        )
        print(f"Agent: {response2.choices[0].message.content}\n")
        time.sleep(1)

        # Step 3: Return policy
        log_session_info("Customer Support", session_id, "STEP 3", "- Return policy explanation")
        response3 = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a helpful e-commerce customer support agent. Be concise and friendly."},
                {"role": "user", "content": "What's your return policy if I'm not satisfied with the phone?"}
            ]
        )
        print(f"Agent: {response3.choices[0].message.content}\n")
        time.sleep(1)

        # Step 4: Order assistance - using more expensive model for complex task
        log_session_info("Customer Support", session_id, "STEP 4", "- Order placement assistance (GPT-4o)")
        response4 = openai_client.chat.completions.create(
            model="gpt-4o",  # More expensive model for complex order processing
            messages=[
                {"role": "system", "content": "You are a helpful e-commerce customer support agent. Guide customers through order placement."},
                {"role": "user", "content": "Perfect! I'd like to place an order for the iPhone 15 Pro 256GB in blue with express shipping. Can you help me with the checkout process?"}
            ]
        )
        print(f"Agent: {response4.choices[0].message.content}\n")

        log_session_info("Customer Support", session_id, "COMPLETE", f"- 4 interactions, mixed models")

def simulate_code_assistant_workflow():
    """
    Scenario: Developer getting help with code
    - Asks for code review
    - Needs debugging help
    - Requests optimization suggestions
    - Gets testing recommendations
    """
    print("\n" + "="*80)
    print("💻 CODE ASSISTANT WORKFLOW")
    print("="*80)

    with ward.SessionContext() as session_id:
        log_session_info("Code Assistant", session_id, "START", "- Python development help")

        # Step 1: Code review with Claude (good for code analysis)
        log_session_info("Code Assistant", session_id, "STEP 1", "- Code review (Claude Sonnet)")
        code_to_review = '''
def calculate_discount(price, user_type, quantity):
    if user_type == "premium":
        discount = 0.15
    elif user_type == "regular":
        discount = 0.10
    else:
        discount = 0.05

    if quantity > 100:
        discount += 0.05
    elif quantity > 50:
        discount += 0.02

    final_price = price * (1 - discount)
    return final_price
'''

        response1 = anthropic_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            messages=[
                {"role": "user", "content": f"Please review this Python code for potential improvements:\n\n{code_to_review}"}
            ]
        )
        print(f"Claude: {response1.content[0].text}\n")
        time.sleep(2)

        # Step 2: Debugging help with GPT-4o
        log_session_info("Code Assistant", session_id, "STEP 2", "- Debugging assistance (GPT-4o)")
        error_code = '''
def process_orders(orders):
    total = 0
    for order in orders:
        total += order['price'] * order['quantity']
        if order['status'] == 'shipped':
            print(f"Order {order['id']} shipped")
    return total

# Error occurs here
orders = [
    {'id': 1, 'price': 10.0, 'quantity': 2, 'status': 'pending'},
    {'id': 2, 'price': 15.0, 'quantity': 1},  # Missing 'status' key
    {'id': 3, 'price': 8.0, 'quantity': 3, 'status': 'shipped'}
]
result = process_orders(orders)
'''

        response2 = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "user", "content": f"This code is throwing a KeyError. Can you identify and fix the issue?\n\n{error_code}"}
            ]
        )
        print(f"GPT-4o: {response2.choices[0].message.content}\n")
        time.sleep(2)

        # Step 3: Optimization with streaming response
        log_session_info("Code Assistant", session_id, "STEP 3", "- Performance optimization (Streaming)")
        slow_code = '''
def find_duplicates(numbers):
    duplicates = []
    for i in range(len(numbers)):
        for j in range(i + 1, len(numbers)):
            if numbers[i] == numbers[j] and numbers[i] not in duplicates:
                duplicates.append(numbers[i])
    return duplicates
'''

        print("GPT-4o (streaming): ", end="", flush=True)
        stream = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "user", "content": f"This function is too slow for large lists. How can I optimize it?\n\n{slow_code}"}
            ],
            stream=True
        )

        for chunk in stream:
            if chunk.choices[0].delta.content is not None:
                print(chunk.choices[0].delta.content, end="", flush=True)
        print("\n")
        time.sleep(1)

        # Step 4: Testing recommendations with GPT-4o-mini (cheaper for simple task)
        log_session_info("Code Assistant", session_id, "STEP 4", "- Test recommendations (GPT-4o-mini)")
        response4 = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": "What unit tests should I write for the optimized find_duplicates function?"}
            ]
        )
        print(f"GPT-4o-mini: {response4.choices[0].message.content}\n")

        log_session_info("Code Assistant", session_id, "COMPLETE", "- 4 interactions, 3 models, streaming")

def simulate_content_pipeline_workflow():
    """
    Scenario: Content creation pipeline
    - Research phase with web search
    - Draft generation
    - Content refinement
    - SEO optimization
    """
    print("\n" + "="*80)
    print("📝 CONTENT CREATION PIPELINE")
    print("="*80)

    with ward.SessionContext() as session_id:
        log_session_info("Content Pipeline", session_id, "START", "- Blog post creation workflow")

        # Step 1: Research phase
        log_session_info("Content Pipeline", session_id, "STEP 1", "- Research (GPT-4o)")
        response1 = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "user", "content": "I need to write a blog post about the benefits of AI observability for developers. Can you provide me with key research points and trending topics in this area?"}
            ]
        )
        print(f"Research: {response1.choices[0].message.content[:200]}...\n")
        time.sleep(2)

        # Step 2: Draft generation with Claude (good for creative writing)
        log_session_info("Content Pipeline", session_id, "STEP 2", "- Draft generation (Claude Sonnet)")
        response2 = anthropic_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            messages=[
                {"role": "user", "content": "Based on AI observability research, write a draft blog post introduction that explains why developers need observability tools for their AI applications. Make it engaging and practical."}
            ]
        )
        print(f"Draft: {response2.content[0].text[:300]}...\n")
        time.sleep(2)

        # Step 3: Content refinement
        log_session_info("Content Pipeline", session_id, "STEP 3", "- Content refinement (GPT-4o)")
        response3 = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "user", "content": "Please refine this blog post introduction to be more technical and include specific examples of observability challenges developers face with LLM applications."}
            ]
        )
        print(f"Refined: {response3.choices[0].message.content[:300]}...\n")
        time.sleep(2)

        # Step 4: SEO optimization with cheaper model
        log_session_info("Content Pipeline", session_id, "STEP 4", "- SEO optimization (GPT-4o-mini)")
        response4 = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": "Suggest 10 SEO-optimized keywords and 5 meta descriptions for a blog post about AI observability for developers."}
            ]
        )
        print(f"SEO: {response4.choices[0].message.content[:200]}...\n")

        log_session_info("Content Pipeline", session_id, "COMPLETE", "- 4 steps, 3 models, high token usage")

async def simulate_async_concurrent_sessions():
    """
    Scenario: Multiple concurrent async sessions
    - Simulates high-load scenario
    - Different conversations happening simultaneously
    - Mix of OpenAI and Anthropic calls
    """
    print("\n" + "="*80)
    print("⚡ CONCURRENT ASYNC SESSIONS")
    print("="*80)

    async def customer_session_1():
        with ward.SessionContext() as session_id:
            log_session_info("Async Customer 1", session_id, "START", "- Product inquiry")

            response = await async_openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a helpful customer service agent."},
                    {"role": "user", "content": "I need help choosing between your basic and premium plans."}
                ]
            )
            log_session_info("Async Customer 1", session_id, "STEP 1", f"- Response: {len(response.choices[0].message.content)} chars")

            await asyncio.sleep(1)

            response2 = await async_openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "user", "content": "What are the main differences in features?"}
                ]
            )
            log_session_info("Async Customer 1", session_id, "COMPLETE", f"- 2 interactions")

    async def technical_session():
        with ward.SessionContext() as session_id:
            log_session_info("Async Technical", session_id, "START", "- API documentation")

            response = await async_anthropic_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=300,
                messages=[
                    {"role": "user", "content": "Explain how to implement rate limiting in a REST API using Python and Redis."}
                ]
            )
            log_session_info("Async Technical", session_id, "COMPLETE", f"- Claude response: {len(response.content[0].text)} chars")

    async def customer_session_2():
        with ward.SessionContext() as session_id:
            log_session_info("Async Customer 2", session_id, "START", "- Billing inquiry")

            response = await async_openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "user", "content": "I was charged twice this month. Can you help me understand my billing?"}
                ]
            )
            log_session_info("Async Customer 2", session_id, "COMPLETE", f"- Billing resolved")

    # Run all sessions concurrently
    await asyncio.gather(
        customer_session_1(),
        technical_session(),
        customer_session_2()
    )

def simulate_error_scenarios():
    """
    Scenario: Error handling and recovery
    - Invalid model names
    - Network timeouts
    - Rate limiting simulation
    """
    print("\n" + "="*80)
    print("🚨 ERROR SCENARIOS")
    print("="*80)

    with ward.SessionContext() as session_id:
        log_session_info("Error Testing", session_id, "START", "- Error handling workflow")

        # Step 1: Successful call first
        log_session_info("Error Testing", session_id, "STEP 1", "- Normal call (baseline)")
        try:
            response1 = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": "Hello, this should work fine."}]
            )
            log_session_info("Error Testing", session_id, "SUCCESS", f"- Response received: {len(response1.choices[0].message.content)} chars")
        except Exception as e:
            log_session_info("Error Testing", session_id, "ERROR", f"- Unexpected error: {e}")

        time.sleep(1)

        # Step 2: Try invalid model (this will fail but be captured in traces)
        log_session_info("Error Testing", session_id, "STEP 2", "- Invalid model test")
        try:
            response2 = openai_client.chat.completions.create(
                model="invalid-model-name",  # This will cause an error
                messages=[{"role": "user", "content": "This will fail."}]
            )
        except Exception as e:
            log_session_info("Error Testing", session_id, "ERROR", f"- Expected error: {type(e).__name__}")

        time.sleep(1)

        # Step 3: Recovery with correct call
        log_session_info("Error Testing", session_id, "STEP 3", "- Recovery call")
        try:
            response3 = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": "This recovery call should work."}]
            )
            log_session_info("Error Testing", session_id, "RECOVERY", f"- Successful recovery: {len(response3.choices[0].message.content)} chars")
        except Exception as e:
            log_session_info("Error Testing", session_id, "ERROR", f"- Recovery failed: {e}")

        log_session_info("Error Testing", session_id, "COMPLETE", "- Error scenario testing done")

def simulate_cost_optimization_workflow():
    """
    Scenario: Cost-conscious development workflow
    - Uses cheaper models for simple tasks
    - More expensive models for complex tasks
    - Shows cost differences in dashboard
    """
    print("\n" + "="*80)
    print("💰 COST OPTIMIZATION WORKFLOW")
    print("="*80)

    with ward.SessionContext() as session_id:
        log_session_info("Cost Optimization", session_id, "START", "- Model selection strategy")

        # Step 1: Simple task with cheapest model
        log_session_info("Cost Optimization", session_id, "STEP 1", "- Simple task (GPT-4o-mini) - ~$0.0001")
        response1 = openai_client.chat.completions.create(
            model="gpt-4o-mini",  # $0.15/$0.60 per 1M tokens
            messages=[
                {"role": "user", "content": "What's 15 * 23?"}
            ]
        )
        print(f"Simple math: {response1.choices[0].message.content}\n")
        time.sleep(1)

        # Step 2: Medium complexity with mid-tier model
        log_session_info("Cost Optimization", session_id, "STEP 2", "- Medium task (GPT-4o) - ~$0.001")
        response2 = openai_client.chat.completions.create(
            model="gpt-4o",  # $2.50/$10.00 per 1M tokens
            messages=[
                {"role": "user", "content": "Explain the difference between REST and GraphQL APIs in 100 words."}
            ]
        )
        print(f"API explanation: {response2.choices[0].message.content[:150]}...\n")
        time.sleep(1)

        # Step 3: Complex reasoning task with premium model
        log_session_info("Cost Optimization", session_id, "STEP 3", "- Complex task (Claude Sonnet) - ~$0.002")
        response3 = anthropic_client.messages.create(
            model="claude-sonnet-4-20250514",  # $3.00/$15.00 per 1M tokens
            max_tokens=1000,
            messages=[
                {"role": "user", "content": "Design a microservices architecture for a social media platform. Include database choices, caching strategies, and explain how to handle 10M daily active users."}
            ]
        )
        print(f"Architecture design: {response3.content[0].text[:200]}...\n")
        time.sleep(1)

        # Step 4: Another simple task to show cost comparison
        log_session_info("Cost Optimization", session_id, "STEP 4", "- Another simple task (GPT-4o-mini) - ~$0.0001")
        response4 = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": "Convert 100 kilometers to miles."}
            ]
        )
        print(f"Unit conversion: {response4.choices[0].message.content}\n")

        log_session_info("Cost Optimization", session_id, "COMPLETE", "- Total estimated cost: ~$0.003")

def print_dashboard_navigation_guide():
    """Print instructions for navigating the dashboard after running tests."""
    print("\n" + "="*80)
    print("🎯 DASHBOARD NAVIGATION GUIDE")
    print("="*80)
    print("""
After running these tests, navigate to: http://localhost:3001/traces

What you'll see in the dashboard:

1. SESSION TABLE - Main view shows:
   ├── Session IDs (truncated, clickable)
   ├── First Message (truncated preview)
   ├── Last Message (truncated preview)
   ├── Duration (total session time)
   ├── Start Time (when session began)
   ├── Traces (number of LLM calls in session)
   └── Tokens & Cost (aggregated metrics)

2. FILTERING OPTIONS:
   ├── Time Range: 1h, 24h, 7d, 30d
   ├── Search: Find sessions by message content
   ├── Environment: Filter by testing/production
   ├── Model: Filter by specific LLM models
   └── Live Toggle: Real-time updates

3. SESSION DRILL-DOWN:
   ├── Click any Session ID to see details
   ├── View all spans in chronological order
   ├── See full request/response attributes
   └── Examine token usage and costs per call

4. EXPECTED TEST RESULTS:
   ├── ~8-10 sessions from different workflows
   ├── Mixed costs: $0.0001 (mini) to $0.002 (complex)
   ├── Various durations: 5-30 seconds
   ├── Different models: GPT-4o, GPT-4o-mini, Claude
   └── Error traces with proper status codes

5. METRICS TO VERIFY:
   ├── Total tokens = input_tokens + output_tokens
   ├── Cost = (input_tokens × input_rate + output_tokens × output_rate) / 1M
   ├── Duration = time from first to last trace in session
   └── First/Last messages match actual conversation flow
""")

def main():
    """Run all test workflows in sequence."""
    print("🚀 Starting Ward SDK Comprehensive Workflow Tests")
    print("=" * 80)
    print("This will generate realistic sessions visible in the dashboard at:")
    print("👉 http://localhost:3001/traces")
    print("=" * 80)

    start_time = time.time()

    try:
        # Run synchronous workflows
        simulate_customer_support_workflow()
        time.sleep(2)

        simulate_code_assistant_workflow()
        time.sleep(2)

        simulate_content_pipeline_workflow()
        time.sleep(2)

        simulate_cost_optimization_workflow()
        time.sleep(2)

        simulate_error_scenarios()
        time.sleep(2)

        # Run async workflows
        print("\n🔄 Running concurrent async workflows...")
        asyncio.run(simulate_async_concurrent_sessions())

        # Summary
        total_time = time.time() - start_time
        print(f"\n✅ All workflows completed in {total_time:.1f} seconds")
        print(f"🎯 Generated ~8-10 sessions with diverse patterns")
        print(f"💰 Mixed cost profiles from $0.0001 to $0.002 per session")
        print(f"📊 Various token usage: 50-2000 tokens per session")

        # Navigation guide
        print_dashboard_navigation_guide()

    except Exception as e:
        print(f"❌ Error during workflow execution: {e}")
        print("Make sure the Ward services are running: docker-compose up -d")

if __name__ == "__main__":
    main()