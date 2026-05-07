#!/usr/bin/env python3
"""
Ward SDK Customer Journey Simulation

Simulates realistic customer journeys through various AI application workflows.
Each journey demonstrates different usage patterns, costs, and observability insights
that customers would see in the Ward traces dashboard.

This script creates documentation-ready examples showing:
- How different user types interact with AI applications
- Cost optimization strategies
- Session-based observability
- Real-world debugging scenarios

Usage:
    python simulate_customer_journey.py --all-journeys
    python simulate_customer_journey.py --journey developer
    python simulate_customer_journey.py --journey customer-support
"""

import ward
import time
import argparse
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

# Initialize Ward SDK
ward.init(
    application_name="customer-journey-simulation",
    environment="production-demo",
    otlp_endpoint="http://localhost:8080",
    otlp_headers={"Authorization": f"Bearer {get_key(find_dotenv(), 'WARD_API_KEY')}"},
    capture_message_content=True,
)

class JourneyDocumenter:
    def __init__(self):
        self.journeys = []
        self.current_journey = None

    def start_journey(self, journey_name, persona, description):
        """Start documenting a new customer journey."""
        self.current_journey = {
            "name": journey_name,
            "persona": persona,
            "description": description,
            "start_time": datetime.now(),
            "sessions": [],
            "total_cost": 0,
            "total_tokens": 0,
            "total_duration": 0,
            "insights": []
        }
        print(f"\n{'='*80}")
        print(f"🎭 CUSTOMER JOURNEY: {journey_name.upper()}")
        print(f"👤 Persona: {persona}")
        print(f"📝 Scenario: {description}")
        print(f"{'='*80}")

    def log_session_start(self, session_name, session_id, objectives):
        """Log the start of a session within a journey."""
        session_data = {
            "name": session_name,
            "session_id": session_id,
            "objectives": objectives,
            "start_time": datetime.now(),
            "interactions": [],
            "cost": 0,
            "tokens": 0,
            "duration": 0
        }
        self.current_journey["sessions"].append(session_data)

        print(f"\n🎯 SESSION: {session_name}")
        print(f"🔗 Session ID: {session_id[:16]}...")
        print(f"📋 Objectives: {', '.join(objectives)}")

    def log_interaction(self, model, prompt, response, tokens, cost, duration):
        """Log an individual AI interaction."""
        if not self.current_journey or not self.current_journey["sessions"]:
            return

        current_session = self.current_journey["sessions"][-1]
        interaction = {
            "timestamp": datetime.now(),
            "model": model,
            "prompt_preview": prompt[:100] + "..." if len(prompt) > 100 else prompt,
            "response_preview": response[:150] + "..." if len(response) > 150 else response,
            "tokens": tokens,
            "cost": cost,
            "duration_ms": duration
        }

        current_session["interactions"].append(interaction)
        current_session["cost"] += cost
        current_session["tokens"] += tokens
        current_session["duration"] += duration

        print(f"   💬 {model}: {tokens} tokens, ${cost:.4f}, {duration:.0f}ms")

    def log_insight(self, insight_type, message):
        """Log an observability insight from this journey."""
        if self.current_journey:
            self.current_journey["insights"].append({
                "type": insight_type,
                "message": message,
                "timestamp": datetime.now()
            })
            print(f"   💡 {insight_type}: {message}")

    def end_journey(self):
        """Complete and summarize the customer journey."""
        if not self.current_journey:
            return

        self.current_journey["end_time"] = datetime.now()
        self.current_journey["total_duration"] = (
            self.current_journey["end_time"] - self.current_journey["start_time"]
        ).total_seconds()

        # Calculate totals
        for session in self.current_journey["sessions"]:
            session["end_time"] = session["start_time"] + timedelta(milliseconds=session["duration"])
            self.current_journey["total_cost"] += session["cost"]
            self.current_journey["total_tokens"] += session["tokens"]

        # Summary
        print(f"\n📊 JOURNEY SUMMARY:")
        print(f"   ⏱️  Total Duration: {self.current_journey['total_duration']:.1f} seconds")
        print(f"   🎯 Sessions: {len(self.current_journey['sessions'])}")
        print(f"   🪙 Total Tokens: {self.current_journey['total_tokens']:,}")
        print(f"   💰 Total Cost: ${self.current_journey['total_cost']:.4f}")

        # Insights summary
        if self.current_journey["insights"]:
            print(f"\n🔍 KEY INSIGHTS:")
            for insight in self.current_journey["insights"]:
                print(f"   • {insight['message']}")

        self.journeys.append(self.current_journey)
        self.current_journey = None

    def save_documentation(self, filename="customer_journeys_report.json"):
        """Save journey documentation to file."""
        with open(filename, 'w') as f:
            json.dump(self.journeys, f, indent=2, default=str)
        print(f"\n💾 Journey documentation saved to: {filename}")

class JourneySimulator:
    def __init__(self):
        self.documenter = JourneyDocumenter()

    def simulate_developer_journey(self):
        """
        Journey: Senior Developer optimizing AI application costs
        Persona: Sarah, Senior Full-stack Developer at a SaaS company
        Goal: Reduce AI costs while maintaining quality
        """
        self.documenter.start_journey(
            "Cost-Conscious Developer",
            "Sarah - Senior Full-stack Developer",
            "Optimizing AI costs for a production application with 10K+ daily users"
        )

        # Session 1: Code review optimization
        with ward.SessionContext() as session_id:
            self.documenter.log_session_start(
                "Code Review Optimization",
                session_id,
                ["Find cheaper model for code reviews", "Maintain code quality", "Reduce review latency"]
            )

            # Try expensive model first (current production setup)
            start_time = time.time()
            code_sample = """
def process_payment(amount, currency, payment_method):
    if amount <= 0:
        return {"error": "Invalid amount"}

    if currency not in ["USD", "EUR", "GBP"]:
        return {"error": "Unsupported currency"}

    # Process payment logic here
    result = payment_gateway.charge(amount, currency, payment_method)

    if result.success:
        send_confirmation_email(result.transaction_id)
        log_transaction(result)
        return {"success": True, "transaction_id": result.transaction_id}
    else:
        return {"error": result.error_message}
"""

            response1 = openai_client.chat.completions.create(
                model="gpt-4o",  # Expensive model
                messages=[
                    {"role": "system", "content": "You are a senior software engineer reviewing code. Provide detailed feedback."},
                    {"role": "user", "content": f"Please review this Python payment processing function:\n\n{code_sample}"}
                ]
            )

            duration1 = (time.time() - start_time) * 1000
            cost1 = self.calculate_cost("gpt-4o", response1.usage.prompt_tokens, response1.usage.completion_tokens)

            self.documenter.log_interaction(
                "gpt-4o",
                "Code review request",
                response1.choices[0].message.content,
                response1.usage.total_tokens,
                cost1,
                duration1
            )

            time.sleep(2)

            # Try cheaper model for comparison
            start_time = time.time()
            response2 = openai_client.chat.completions.create(
                model="gpt-4o-mini",  # Cheaper model
                messages=[
                    {"role": "system", "content": "You are a senior software engineer reviewing code. Provide detailed feedback."},
                    {"role": "user", "content": f"Please review this Python payment processing function:\n\n{code_sample}"}
                ]
            )

            duration2 = (time.time() - start_time) * 1000
            cost2 = self.calculate_cost("gpt-4o-mini", response2.usage.prompt_tokens, response2.usage.completion_tokens)

            self.documenter.log_interaction(
                "gpt-4o-mini",
                "Same code review request",
                response2.choices[0].message.content,
                response2.usage.total_tokens,
                cost2,
                duration2
            )

            # Cost analysis insight
            savings = ((cost1 - cost2) / cost1) * 100
            self.documenter.log_insight(
                "Cost Optimization",
                f"GPT-4o-mini provides {savings:.0f}% cost savings vs GPT-4o for code reviews"
            )

        # Session 2: A/B testing different models for user support
        with ward.SessionContext() as session_id:
            self.documenter.log_session_start(
                "Support Bot Model Selection",
                session_id,
                ["Test GPT-4o-mini vs Claude for customer support", "Measure response quality", "Calculate cost impact"]
            )

            support_query = "I'm having trouble with my subscription billing. I was charged twice this month and need help understanding why."

            # Test GPT-4o-mini
            start_time = time.time()
            response3 = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a helpful customer support agent. Be empathetic and provide clear solutions."},
                    {"role": "user", "content": support_query}
                ]
            )

            duration3 = (time.time() - start_time) * 1000
            cost3 = self.calculate_cost("gpt-4o-mini", response3.usage.prompt_tokens, response3.usage.completion_tokens)

            self.documenter.log_interaction(
                "gpt-4o-mini",
                support_query,
                response3.choices[0].message.content,
                response3.usage.total_tokens,
                cost3,
                duration3
            )

            time.sleep(2)

            # Test Claude
            start_time = time.time()
            response4 = anthropic_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=300,
                messages=[
                    {"role": "user", "content": f"As a customer support agent, help with this query: {support_query}"}
                ]
            )

            duration4 = (time.time() - start_time) * 1000
            cost4 = self.calculate_cost("claude-sonnet-4-20250514", response4.usage.input_tokens, response4.usage.output_tokens)

            self.documenter.log_interaction(
                "claude-sonnet-4-20250514",
                support_query,
                response4.content[0].text,
                response4.usage.input_tokens + response4.usage.output_tokens,
                cost4,
                duration4
            )

            # Model comparison insight
            if cost3 < cost4:
                cheaper_model = "GPT-4o-mini"
                savings = ((cost4 - cost3) / cost4) * 100
            else:
                cheaper_model = "Claude Sonnet"
                savings = ((cost3 - cost4) / cost3) * 100

            self.documenter.log_insight(
                "Model Comparison",
                f"{cheaper_model} provides {savings:.0f}% cost savings for customer support queries"
            )

        # Session 3: Production cost monitoring
        with ward.SessionContext() as session_id:
            self.documenter.log_session_start(
                "Production Cost Analysis",
                session_id,
                ["Analyze current usage patterns", "Identify optimization opportunities", "Set up cost alerts"]
            )

            # Simulate high-volume, low-cost operations
            queries = [
                "What's our pricing for the enterprise plan?",
                "How do I reset my password?",
                "Where can I find the API documentation?",
                "What's included in the free tier?",
                "How do I upgrade my account?"
            ]

            total_queries_cost = 0
            for i, query in enumerate(queries):
                start_time = time.time()
                response = openai_client.chat.completions.create(
                    model="gpt-4o-mini",  # Optimized for high volume
                    messages=[
                        {"role": "system", "content": "You are a helpful assistant. Provide concise, accurate answers."},
                        {"role": "user", "content": query}
                    ],
                    max_tokens=100  # Limit response length to control costs
                )

                duration = (time.time() - start_time) * 1000
                cost = self.calculate_cost("gpt-4o-mini", response.usage.prompt_tokens, response.usage.completion_tokens)
                total_queries_cost += cost

                self.documenter.log_interaction(
                    "gpt-4o-mini",
                    query,
                    response.choices[0].message.content,
                    response.usage.total_tokens,
                    cost,
                    duration
                )

                time.sleep(0.5)  # Simulate rapid queries

            # Volume cost analysis
            daily_volume = 10000  # 10K queries per day
            daily_cost = total_queries_cost * (daily_volume / len(queries))
            monthly_cost = daily_cost * 30

            self.documenter.log_insight(
                "Volume Analysis",
                f"At 10K daily queries: ${daily_cost:.2f}/day, ${monthly_cost:.2f}/month"
            )

        self.documenter.end_journey()

    def simulate_customer_support_journey(self):
        """
        Journey: Customer Support Manager optimizing response quality
        Persona: Mike, Customer Support Manager
        Goal: Improve customer satisfaction while managing costs
        """
        self.documenter.start_journey(
            "Customer Support Optimization",
            "Mike - Customer Support Manager",
            "Optimizing AI-powered support for better customer experience and cost efficiency"
        )

        # Session 1: Escalation handling
        with ward.SessionContext() as session_id:
            self.documenter.log_session_start(
                "Complex Issue Escalation",
                session_id,
                ["Handle complex billing dispute", "Provide detailed explanation", "Ensure customer satisfaction"]
            )

            complex_issue = """
            Customer complaint: I've been charged $299.99 three times in the past month for the same service.
            My bank shows three separate charges on March 3rd, March 15th, and March 28th. I only signed up once
            and expected to pay monthly. I've tried reaching out through your chat system but keep getting generic
            responses. This is unacceptable and I'm considering disputing these charges with my bank.
            I need someone to actually look into this and fix it immediately.
            """

            # Use premium model for complex issues
            start_time = time.time()
            response = openai_client.chat.completions.create(
                model="gpt-4o",  # Premium model for complex issues
                messages=[
                    {"role": "system", "content": "You are a senior customer support specialist handling escalated issues. Be thorough, empathetic, and provide specific action steps."},
                    {"role": "user", "content": complex_issue}
                ]
            )

            duration = (time.time() - start_time) * 1000
            cost = self.calculate_cost("gpt-4o", response.usage.prompt_tokens, response.usage.completion_tokens)

            self.documenter.log_interaction(
                "gpt-4o",
                "Complex billing dispute",
                response.choices[0].message.content,
                response.usage.total_tokens,
                cost,
                duration
            )

            self.documenter.log_insight(
                "Escalation Strategy",
                "Premium models justify higher cost for complex issues that could lead to churn"
            )

        # Session 2: High-volume simple queries
        with ward.SessionContext() as session_id:
            self.documenter.log_session_start(
                "Simple Query Processing",
                session_id,
                ["Handle routine questions efficiently", "Maintain response quality", "Minimize per-query cost"]
            )

            simple_queries = [
                "How do I change my password?",
                "What are your business hours?",
                "Where can I download the mobile app?",
                "How do I cancel my subscription?",
                "What payment methods do you accept?"
            ]

            for query in simple_queries:
                start_time = time.time()
                response = openai_client.chat.completions.create(
                    model="gpt-4o-mini",  # Cost-effective for simple queries
                    messages=[
                        {"role": "system", "content": "You are a helpful customer support agent. Provide clear, concise answers."},
                        {"role": "user", "content": query}
                    ],
                    max_tokens=150
                )

                duration = (time.time() - start_time) * 1000
                cost = self.calculate_cost("gpt-4o-mini", response.usage.prompt_tokens, response.usage.completion_tokens)

                self.documenter.log_interaction(
                    "gpt-4o-mini",
                    query,
                    response.choices[0].message.content,
                    response.usage.total_tokens,
                    cost,
                    duration
                )

                time.sleep(0.3)  # Simulate rapid processing

            self.documenter.log_insight(
                "Volume Efficiency",
                "GPT-4o-mini handles 80% of simple queries at 1/16th the cost of GPT-4o"
            )

        self.documenter.end_journey()

    def simulate_content_creator_journey(self):
        """
        Journey: Content Creator optimizing for different content types
        Persona: Emma, Content Marketing Manager
        Goal: Create diverse content efficiently while maintaining quality
        """
        self.documenter.start_journey(
            "Content Creation Optimization",
            "Emma - Content Marketing Manager",
            "Creating diverse marketing content with optimal model selection for each task"
        )

        # Session 1: Blog post creation pipeline
        with ward.SessionContext() as session_id:
            self.documenter.log_session_start(
                "Blog Post Creation Pipeline",
                session_id,
                ["Research trending topics", "Create engaging outline", "Write compelling content", "Optimize for SEO"]
            )

            # Research phase - use powerful model for comprehensive analysis
            start_time = time.time()
            research_response = openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are a marketing research analyst. Provide comprehensive, data-driven insights."},
                    {"role": "user", "content": "Research current trends in AI observability tools for DevOps teams. Include market insights, key pain points, and emerging solutions."}
                ]
            )

            duration = (time.time() - start_time) * 1000
            cost = self.calculate_cost("gpt-4o", research_response.usage.prompt_tokens, research_response.usage.completion_tokens)

            self.documenter.log_interaction(
                "gpt-4o",
                "Market research for blog topic",
                research_response.choices[0].message.content,
                research_response.usage.total_tokens,
                cost,
                duration
            )

            time.sleep(2)

            # Content creation - use Claude for creative writing
            start_time = time.time()
            content_response = anthropic_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1500,
                messages=[
                    {"role": "user", "content": "Based on AI observability research, write an engaging blog post introduction that hooks readers and clearly explains the value proposition. Make it conversational yet professional."}
                ]
            )

            duration = (time.time() - start_time) * 1000
            cost = self.calculate_cost("claude-sonnet-4-20250514", content_response.usage.input_tokens, content_response.usage.output_tokens)

            self.documenter.log_interaction(
                "claude-sonnet-4-20250514",
                "Blog post introduction",
                content_response.content[0].text,
                content_response.usage.input_tokens + content_response.usage.output_tokens,
                cost,
                duration
            )

            time.sleep(2)

            # SEO optimization - use cost-effective model
            start_time = time.time()
            seo_response = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are an SEO specialist. Provide actionable optimization recommendations."},
                    {"role": "user", "content": "Generate SEO keywords, meta descriptions, and title variations for a blog post about AI observability tools for DevOps teams."}
                ]
            )

            duration = (time.time() - start_time) * 1000
            cost = self.calculate_cost("gpt-4o-mini", seo_response.usage.prompt_tokens, seo_response.usage.completion_tokens)

            self.documenter.log_interaction(
                "gpt-4o-mini",
                "SEO optimization",
                seo_response.choices[0].message.content,
                seo_response.usage.total_tokens,
                cost,
                duration
            )

            self.documenter.log_insight(
                "Content Pipeline",
                "Multi-model approach: Research (GPT-4o) → Creative (Claude) → SEO (GPT-4o-mini) optimizes cost/quality"
            )

        # Session 2: Social media content generation
        with ward.SessionContext() as session_id:
            self.documenter.log_session_start(
                "Social Media Content Creation",
                session_id,
                ["Create platform-specific content", "Maintain brand voice", "Generate multiple variations"]
            )

            platforms = ["Twitter", "LinkedIn", "Instagram"]

            for platform in platforms:
                start_time = time.time()
                response = openai_client.chat.completions.create(
                    model="gpt-4o-mini",  # Cost-effective for short-form content
                    messages=[
                        {"role": "system", "content": f"You are a social media manager creating content for {platform}. Match the platform's style and best practices."},
                        {"role": "user", "content": f"Create 3 variations of social media posts about AI observability tools for {platform}. Include relevant hashtags and calls-to-action."}
                    ],
                    max_tokens=400
                )

                duration = (time.time() - start_time) * 1000
                cost = self.calculate_cost("gpt-4o-mini", response.usage.prompt_tokens, response.usage.completion_tokens)

                self.documenter.log_interaction(
                    "gpt-4o-mini",
                    f"{platform} content creation",
                    response.choices[0].message.content,
                    response.usage.total_tokens,
                    cost,
                    duration
                )

                time.sleep(1)

            self.documenter.log_insight(
                "Social Media Efficiency",
                "GPT-4o-mini perfect for social media: fast, cost-effective, maintains brand voice"
            )

        self.documenter.end_journey()

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

    def simulate_debugging_journey(self):
        """
        Journey: Developer debugging production issues using observability
        Persona: Alex, Senior Backend Engineer
        Goal: Identify and fix performance issues in AI-powered features
        """
        self.documenter.start_journey(
            "Production Debugging",
            "Alex - Senior Backend Engineer",
            "Using Ward observability to debug slow response times in AI features"
        )

        # Session 1: Performance analysis
        with ward.SessionContext() as session_id:
            self.documenter.log_session_start(
                "Performance Issue Investigation",
                session_id,
                ["Identify slow queries", "Analyze token usage patterns", "Find optimization opportunities"]
            )

            # Simulate expensive query that's causing issues
            start_time = time.time()
            expensive_response = openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are a comprehensive business analyst. Provide detailed analysis with multiple perspectives and actionable recommendations."},
                    {"role": "user", "content": "Analyze the market opportunity for AI observability tools in the enterprise segment. Include competitive landscape, pricing strategies, customer segments, go-to-market approaches, technical requirements, compliance considerations, and 5-year market projections with supporting data and reasoning."}
                ],
                max_tokens=2000  # Very long response
            )

            duration = (time.time() - start_time) * 1000
            cost = self.calculate_cost("gpt-4o", expensive_response.usage.prompt_tokens, expensive_response.usage.completion_tokens)

            self.documenter.log_interaction(
                "gpt-4o",
                "Comprehensive market analysis",
                expensive_response.choices[0].message.content,
                expensive_response.usage.total_tokens,
                cost,
                duration
            )

            self.documenter.log_insight(
                "Performance Issue Found",
                f"High-cost query detected: {expensive_response.usage.total_tokens} tokens, ${cost:.4f}, {duration:.0f}ms"
            )

            time.sleep(3)

            # Test optimized version
            start_time = time.time()
            optimized_response = openai_client.chat.completions.create(
                model="gpt-4o-mini",  # Cheaper model
                messages=[
                    {"role": "system", "content": "You are a business analyst. Provide concise, focused analysis."},
                    {"role": "user", "content": "Provide a concise analysis of the AI observability tools market opportunity for enterprises. Focus on key insights and actionable recommendations."}
                ],
                max_tokens=500  # Controlled response length
            )

            duration_opt = (time.time() - start_time) * 1000
            cost_opt = self.calculate_cost("gpt-4o-mini", optimized_response.usage.prompt_tokens, optimized_response.usage.completion_tokens)

            self.documenter.log_interaction(
                "gpt-4o-mini",
                "Focused market analysis",
                optimized_response.choices[0].message.content,
                optimized_response.usage.total_tokens,
                cost_opt,
                duration_opt
            )

            # Calculate improvements
            cost_savings = ((cost - cost_opt) / cost) * 100
            speed_improvement = ((duration - duration_opt) / duration) * 100

            self.documenter.log_insight(
                "Optimization Results",
                f"Optimization achieved {cost_savings:.0f}% cost reduction and {speed_improvement:.0f}% speed improvement"
            )

        self.documenter.end_journey()

def print_dashboard_guide():
    """Print comprehensive dashboard navigation guide."""
    print("\n" + "="*80)
    print("🎯 DASHBOARD EXPLORATION GUIDE")
    print("="*80)

    print(f"\n🌐 Access the Ward Dashboard:")
    print(f"   👉 http://localhost:3001/traces")
    print(f"   👉 http://localhost:3001/costs")

    print(f"\n🔍 What to Look For After Running Journeys:")

    print(f"\n1. SESSION GROUPING:")
    print(f"   • Each journey creates multiple sessions")
    print(f"   • Sessions group related conversations together")
    print(f"   • Click session IDs to see detailed traces")

    print(f"\n2. COST PATTERNS:")
    print(f"   • Developer Journey: Shows A/B testing different models")
    print(f"   • Support Journey: Expensive vs cheap model usage")
    print(f"   • Content Journey: Multi-model pipeline costs")
    print(f"   • Debugging Journey: Before/after optimization")

    print(f"\n3. FILTERING & SEARCH:")
    print(f"   • Search 'billing' - finds support sessions")
    print(f"   • Search 'code review' - finds developer sessions")
    print(f"   • Filter by 'gpt-4o' vs 'gpt-4o-mini' - cost comparison")
    print(f"   • Time ranges - see recent vs older sessions")

    print(f"\n4. METRICS TO VERIFY:")
    print(f"   • Token counts vary by model and task complexity")
    print(f"   • Costs: GPT-4o > Claude > GPT-4o-mini")
    print(f"   • Duration includes network latency + processing time")
    print(f"   • Sessions show first/last messages correctly")

    print(f"\n5. USER INSIGHTS:")
    print(f"   • Developer: Cost optimization through model selection")
    print(f"   • Support: Premium models for complex issues")
    print(f"   • Content: Multi-model pipeline for different tasks")
    print(f"   • Debugging: Performance optimization tracking")

    print(f"\n🎨 Session Types Generated:")
    print(f"   🔧 Code Review Optimization")
    print(f"   🎯 A/B Model Testing")
    print(f"   📞 Support Escalation Handling")
    print(f"   📝 Content Creation Pipeline")
    print(f"   🐛 Performance Debugging")
    print(f"   📊 Volume Cost Analysis")

def main():
    parser = argparse.ArgumentParser(description="Simulate realistic customer journeys")
    parser.add_argument("--journey", choices=["developer", "customer-support", "content-creator", "debugging"],
                       help="Run specific journey type")
    parser.add_argument("--all-journeys", action="store_true", help="Run all customer journey types")

    args = parser.parse_args()

    simulator = JourneySimulator()

    print("🎭 Ward SDK Customer Journey Simulation")
    print("=" * 80)
    print("Simulating realistic customer workflows to demonstrate")
    print("Ward's observability capabilities and cost optimization strategies.")
    print("=" * 80)

    if args.all_journeys or not args.journey:
        print("🚀 Running all customer journeys...")
        simulator.simulate_developer_journey()
        time.sleep(3)
        simulator.simulate_customer_support_journey()
        time.sleep(3)
        simulator.simulate_content_creator_journey()
        time.sleep(3)
        simulator.simulate_debugging_journey()
    else:
        print(f"🎯 Running {args.journey} journey...")
        if args.journey == "developer":
            simulator.simulate_developer_journey()
        elif args.journey == "customer-support":
            simulator.simulate_customer_support_journey()
        elif args.journey == "content-creator":
            simulator.simulate_content_creator_journey()
        elif args.journey == "debugging":
            simulator.simulate_debugging_journey()

    # Save documentation
    simulator.documenter.save_documentation()

    # Print dashboard guide
    print_dashboard_guide()

    print(f"\n✅ Customer journey simulation complete!")
    print(f"📊 View results in dashboard: http://localhost:3001/traces")
    print(f"💾 Journey documentation saved to: customer_journeys_report.json")

if __name__ == "__main__":
    main()