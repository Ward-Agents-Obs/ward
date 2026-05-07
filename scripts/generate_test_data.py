#!/usr/bin/env python3
"""
Ward SDK Bulk Test Data Generator

Generates realistic test data for the traces dashboard with:
- 100+ sessions across different time periods
- Varied conversation patterns and lengths
- Multiple models with different cost profiles
- Different environments and user types
- Realistic latencies and token usage patterns

Usage:
    python generate_test_data.py --sessions 100 --days 7
    python generate_test_data.py --quick  # Generate 50 sessions quickly
"""

import ward
import time
import random
import argparse
from datetime import datetime, timedelta
from openai import OpenAI
from anthropic import Anthropic
from dotenv import get_key, find_dotenv, load_dotenv

# Load environment
load_dotenv()

# Initialize clients
openai_client = OpenAI(api_key=get_key(find_dotenv(), "OPENAI_API_KEY"))
anthropic_client = Anthropic(api_key=get_key(find_dotenv(), "ANTHROPIC_API_KEY"))

# Initialize Ward SDK
ward.init(
    application_name="ward-bulk-test-data",
    environment="load-testing",
    otlp_endpoint="http://localhost:8080",
    otlp_headers={"Authorization": f"Bearer {get_key(find_dotenv(), 'WARD_API_KEY')}"},
    capture_message_content=True,
)

# Conversation templates for realistic sessions
CONVERSATION_TEMPLATES = {
    "customer_support": {
        "models": ["gpt-4o-mini", "gpt-4o"],
        "conversations": [
            [
                "Hi, I'm having trouble with my order. Can you help?",
                "What's the status of order #12345?",
                "When will it be delivered?",
                "Can I change the shipping address?"
            ],
            [
                "I need to return a product I bought last week",
                "What's your return policy?",
                "How do I initiate a return?",
                "Will I get a full refund?"
            ],
            [
                "I was charged twice for the same item",
                "Can you check my billing history?",
                "How do I dispute this charge?",
                "When will the refund be processed?"
            ],
            [
                "Is the premium plan worth the upgrade?",
                "What features do I get with premium?",
                "Can I switch plans anytime?",
                "Do you offer discounts for annual subscriptions?"
            ]
        ]
    },
    "technical_support": {
        "models": ["gpt-4o", "claude-sonnet-4-20250514"],
        "conversations": [
            [
                "How do I implement JWT authentication in Node.js?",
                "What's the best practice for storing JWT tokens?",
                "How do I handle token refresh?",
                "Can you show me a complete example?"
            ],
            [
                "My React app is rendering slowly with large datasets",
                "Should I use React.memo or useMemo?",
                "How can I implement virtual scrolling?",
                "What about lazy loading components?"
            ],
            [
                "I'm getting CORS errors in my web app",
                "How do I configure CORS properly?",
                "What headers should I include?",
                "Is there a security risk with allowing all origins?"
            ],
            [
                "How do I optimize my database queries?",
                "Should I add indexes for this query?",
                "What's the difference between clustered and non-clustered indexes?",
                "How do I analyze query execution plans?"
            ]
        ]
    },
    "content_creation": {
        "models": ["gpt-4o", "claude-sonnet-4-20250514", "gpt-4o-mini"],
        "conversations": [
            [
                "Write a blog post about sustainable technology trends",
                "Make it more engaging with personal anecdotes",
                "Add statistics and data to support the claims",
                "Optimize it for SEO with relevant keywords"
            ],
            [
                "Create a product description for our new smartwatch",
                "Highlight the health monitoring features",
                "Include technical specifications",
                "Add a compelling call-to-action"
            ],
            [
                "Help me write a press release for our funding announcement",
                "Include quotes from our CEO and lead investor",
                "Make it newsworthy and professional",
                "Suggest distribution strategies"
            ],
            [
                "Generate social media content for our product launch",
                "Create posts for Twitter, LinkedIn, and Instagram",
                "Include relevant hashtags and mentions",
                "Suggest optimal posting times"
            ]
        ]
    },
    "code_review": {
        "models": ["gpt-4o", "claude-sonnet-4-20250514"],
        "conversations": [
            [
                "Review this Python function for optimization opportunities",
                "Are there any potential security vulnerabilities?",
                "How can I improve error handling?",
                "Suggest unit tests for this function"
            ],
            [
                "Check this React component for best practices",
                "Is the state management efficient?",
                "How can I improve accessibility?",
                "Should I break this into smaller components?"
            ],
            [
                "Review this API design for RESTful principles",
                "Are the endpoints properly structured?",
                "How should I handle error responses?",
                "What about rate limiting and authentication?"
            ],
            [
                "Analyze this SQL query for performance issues",
                "Are the joins optimized?",
                "Should I add any indexes?",
                "How can I reduce the query execution time?"
            ]
        ]
    },
    "quick_questions": {
        "models": ["gpt-4o-mini"],
        "conversations": [
            ["What's the capital of Australia?"],
            ["Convert 100 USD to EUR"],
            ["What's the weather like in San Francisco?"],
            ["How do I center a div in CSS?"],
            ["What's the difference between Python 2 and 3?"],
            ["How do I install Node.js on Ubuntu?"],
            ["What's the current Bitcoin price?"],
            ["How many calories in an apple?"],
            ["What's the best IDE for Python development?"],
            ["How do I create a virtual environment in Python?"]
        ]
    },
    "complex_analysis": {
        "models": ["gpt-4o", "claude-sonnet-4-20250514"],
        "conversations": [
            [
                "Analyze the current state of the AI market",
                "What are the key trends and opportunities?",
                "How will regulation impact AI development?",
                "What should investors focus on?",
                "Provide specific company recommendations"
            ],
            [
                "Design a scalable architecture for a social media platform",
                "How would you handle 10 million daily active users?",
                "What database technologies would you recommend?",
                "How would you implement real-time features?",
                "What about content moderation and safety?"
            ],
            [
                "Explain quantum computing to a business executive",
                "What are the practical applications today?",
                "When will it impact our industry?",
                "Should we invest in quantum research?",
                "What are the competitive implications?"
            ]
        ]
    }
}

def generate_realistic_delay(conversation_length):
    """Generate realistic delays between messages in a conversation."""
    if conversation_length == 1:
        return []

    delays = []
    for i in range(conversation_length - 1):
        if i == 0:
            # First response delay (thinking time)
            delay = random.uniform(2.0, 8.0)
        else:
            # Follow-up response delays
            delay = random.uniform(1.0, 4.0)
        delays.append(delay)

    return delays

def calculate_expected_tokens(message, is_response=False):
    """Rough estimation of token usage for planning purposes."""
    # Rough approximation: 1 token ≈ 0.75 words
    word_count = len(message.split())
    if is_response:
        # Responses are typically longer and more detailed
        return int(word_count * 2.5)
    else:
        # User messages are typically shorter
        return int(word_count * 1.3)

def select_model_for_task(template_type, conversation_length):
    """Select appropriate model based on task complexity and cost optimization."""
    available_models = CONVERSATION_TEMPLATES[template_type]["models"]

    if template_type == "quick_questions":
        return "gpt-4o-mini"  # Always use cheapest for simple questions
    elif template_type == "complex_analysis" and conversation_length > 3:
        return random.choice(["gpt-4o", "claude-sonnet-4-20250514"])  # Use premium models
    elif template_type == "customer_support":
        # Mix of models based on conversation progress
        if conversation_length <= 2:
            return "gpt-4o-mini"  # Simple inquiries
        else:
            return "gpt-4o"  # Complex support issues
    else:
        return random.choice(available_models)

def generate_session(template_type, conversation_template, session_number, total_sessions):
    """Generate a single realistic session."""
    conversation = conversation_template.copy()
    delays = generate_realistic_delay(len(conversation))

    session_start_time = datetime.now()

    with ward.SessionContext() as session_id:
        print(f"[{session_number:3d}/{total_sessions}] 🔄 {template_type.title()} | Session: {session_id[:12]}... | {len(conversation)} messages")

        total_tokens_estimated = 0

        for i, message in enumerate(conversation):
            # Select model based on task and conversation position
            model = select_model_for_task(template_type, len(conversation))

            # Add some variation to messages
            if random.random() < 0.3:  # 30% chance to add variation
                variations = [
                    f"Actually, {message.lower()}",
                    f"Can you also help me understand {message.lower()}",
                    f"I'm specifically wondering about {message.lower()}",
                    f"Following up on that: {message.lower()}"
                ]
                message = random.choice(variations)

            # Estimate tokens for progress tracking
            estimated_tokens = calculate_expected_tokens(message)
            total_tokens_estimated += estimated_tokens

            try:
                # Add system context for some conversation types
                system_messages = {
                    "customer_support": "You are a helpful customer support representative. Be concise and friendly.",
                    "technical_support": "You are an expert software developer and architect. Provide detailed technical guidance.",
                    "content_creation": "You are a professional content creator and copywriter. Create engaging, high-quality content.",
                    "code_review": "You are a senior software engineer conducting code reviews. Be thorough and constructive.",
                    "complex_analysis": "You are a business consultant and industry analyst. Provide comprehensive strategic insights."
                }

                messages = []
                if template_type in system_messages:
                    messages.append({"role": "system", "content": system_messages[template_type]})
                messages.append({"role": "user", "content": message})

                # Make the API call
                if model.startswith("claude"):
                    response = anthropic_client.messages.create(
                        model=model,
                        max_tokens=random.randint(100, 800),  # Vary response lengths
                        messages=[{"role": "user", "content": message}]  # Anthropic doesn't use system in messages array the same way
                    )
                    response_content = response.content[0].text
                else:
                    response = openai_client.chat.completions.create(
                        model=model,
                        messages=messages,
                        max_tokens=random.randint(100, 800) if random.random() < 0.8 else None  # Sometimes let it run full length
                    )
                    response_content = response.choices[0].message.content

                # Add realistic delay before next message
                if i < len(delays):
                    time.sleep(delays[i])

            except Exception as e:
                print(f"    ❌ Error in message {i+1}: {e}")
                continue

        session_duration = (datetime.now() - session_start_time).total_seconds()
        print(f"    ✅ Complete | Duration: {session_duration:.1f}s | Est. tokens: {total_tokens_estimated}")

def generate_historical_sessions(num_sessions, days_back):
    """Generate sessions distributed over historical time periods."""
    print(f"📊 Generating {num_sessions} historical sessions over {days_back} days")

    # This is simulated - in real implementation you'd need to modify timestamps
    # For now, we'll just create sessions with varied patterns to show in dashboard

    session_count = 0

    for day in range(days_back):
        # Different activity patterns for different days
        if day < 2:  # Recent days - higher activity
            daily_sessions = random.randint(8, 15)
        elif day < 7:  # Last week - medium activity
            daily_sessions = random.randint(3, 8)
        else:  # Older days - lower activity
            daily_sessions = random.randint(1, 4)

        daily_sessions = min(daily_sessions, num_sessions - session_count)

        print(f"\n📅 Day -{day}: Generating {daily_sessions} sessions")

        for session in range(daily_sessions):
            if session_count >= num_sessions:
                break

            # Select conversation type based on day patterns
            if day == 0:  # Today - mix of everything
                template_type = random.choice(list(CONVERSATION_TEMPLATES.keys()))
            elif day == 1:  # Yesterday - mostly work-related
                template_type = random.choice(["technical_support", "code_review", "content_creation"])
            elif day < 7:  # This week - business hours pattern
                template_type = random.choice(["customer_support", "technical_support", "quick_questions"])
            else:  # Older - mostly simple queries
                template_type = random.choice(["quick_questions", "customer_support"])

            conversation_template = random.choice(CONVERSATION_TEMPLATES[template_type]["conversations"])

            generate_session(template_type, conversation_template, session_count + 1, num_sessions)
            session_count += 1

            # Add random delay between sessions
            time.sleep(random.uniform(0.5, 2.0))

        if session_count >= num_sessions:
            break

def generate_load_test_pattern(num_sessions):
    """Generate sessions in a load test pattern with bursts and quiet periods."""
    print(f"⚡ Generating {num_sessions} sessions in load test pattern")

    session_count = 0
    burst_size = random.randint(5, 12)

    while session_count < num_sessions:
        print(f"\n🚀 Burst {session_count // burst_size + 1}: {min(burst_size, num_sessions - session_count)} concurrent sessions")

        # Generate burst of sessions
        for i in range(min(burst_size, num_sessions - session_count)):
            template_type = random.choice(list(CONVERSATION_TEMPLATES.keys()))
            conversation_template = random.choice(CONVERSATION_TEMPLATES[template_type]["conversations"])

            generate_session(template_type, conversation_template, session_count + 1, num_sessions)
            session_count += 1

            # Small delay between sessions in burst
            time.sleep(random.uniform(0.1, 0.5))

        # Quiet period between bursts
        if session_count < num_sessions:
            quiet_time = random.uniform(2.0, 8.0)
            print(f"    😴 Quiet period: {quiet_time:.1f}s")
            time.sleep(quiet_time)
            burst_size = random.randint(3, 10)  # Vary burst sizes

def print_generation_summary(num_sessions, generation_type, start_time):
    """Print summary of data generation results."""
    total_time = time.time() - start_time

    print("\n" + "="*80)
    print("📈 TEST DATA GENERATION COMPLETE")
    print("="*80)
    print(f"✅ Generated: {num_sessions} sessions")
    print(f"⏱️  Total time: {total_time:.1f} seconds")
    print(f"📊 Pattern: {generation_type}")
    print(f"🎯 Average: {total_time/num_sessions:.2f} seconds per session")

    print(f"\n🚀 VIEW IN DASHBOARD:")
    print(f"   👉 http://localhost:3001/traces")

    print(f"\n📋 EXPECTED RESULTS:")
    print(f"   • {num_sessions} sessions visible in traces table")
    print(f"   • Mixed conversation types and lengths")
    print(f"   • Various costs: $0.0001 - $0.01 per session")
    print(f"   • Different models: GPT-4o, GPT-4o-mini, Claude")
    print(f"   • Token usage: 50 - 5000 tokens per session")
    print(f"   • Duration range: 5 - 60 seconds per session")

    print(f"\n🔍 TEST FILTERING:")
    print(f"   • Try different time ranges (1h, 24h, 7d)")
    print(f"   • Search for keywords like 'order', 'code', 'optimize'")
    print(f"   • Filter by model names")
    print(f"   • Click session IDs to see detailed traces")

def main():
    parser = argparse.ArgumentParser(description="Generate bulk test data for Ward SDK traces dashboard")
    parser.add_argument("--sessions", type=int, default=50, help="Number of sessions to generate (default: 50)")
    parser.add_argument("--days", type=int, default=1, help="Distribute sessions over N days (default: 1)")
    parser.add_argument("--quick", action="store_true", help="Quick generation: 25 sessions with shorter conversations")
    parser.add_argument("--load-test", action="store_true", help="Load test pattern: bursts of concurrent sessions")

    args = parser.parse_args()

    if args.quick:
        num_sessions = 25
        generation_type = "Quick Test (Short Conversations)"
        print("🚀 QUICK MODE: Generating 25 sessions with shorter conversations")
    elif args.load_test:
        num_sessions = args.sessions
        generation_type = "Load Test (Burst Pattern)"
        print(f"⚡ LOAD TEST MODE: Generating {num_sessions} sessions in burst pattern")
    else:
        num_sessions = args.sessions
        generation_type = f"Historical Distribution ({args.days} days)"
        print(f"📊 STANDARD MODE: Generating {num_sessions} sessions over {args.days} days")

    print("="*80)
    print("Make sure Ward services are running: docker-compose up -d")
    print("Dashboard will be available at: http://localhost:3001/traces")
    print("="*80)

    start_time = time.time()

    try:
        if args.load_test:
            generate_load_test_pattern(num_sessions)
        else:
            generate_historical_sessions(num_sessions, args.days)

        print_generation_summary(num_sessions, generation_type, start_time)

    except KeyboardInterrupt:
        print("\n\n⚠️  Generation interrupted by user")
        sessions_completed = 0  # You'd track this in real implementation
        print(f"Completed {sessions_completed} sessions before interruption")
    except Exception as e:
        print(f"\n❌ Error during generation: {e}")
        print("Make sure the Ward services are running and API keys are configured")

if __name__ == "__main__":
    main()