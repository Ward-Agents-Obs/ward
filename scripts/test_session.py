import ward
from openai import OpenAI
from dotenv import get_key, find_dotenv, load_dotenv

load_dotenv()

# Initialize Ward SDK with session tracking
ward.init(
    application_name="session-test-app",
    otlp_endpoint="http://localhost:8080",
    otlp_headers={"Authorization": f"Bearer {get_key(find_dotenv(), 'WARD_API_KEY')}"},
)

client = OpenAI(api_key=get_key(find_dotenv(), "OPENAI_API_KEY"))

print("Testing Ward SDK with Session Tracking")

# Test 1: Automatic session creation
print("\n=== Test 1: Automatic session creation ===")
response1 = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello, what's the weather like?"}],
)
print(f"Response 1: {response1.choices[0].message.content[:50]}...")

# Test 2: Same session (should use same session ID automatically)
response2 = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Can you be more specific about today's weather?"}],
)
print(f"Response 2: {response2.choices[0].message.content[:50]}...")

# Test 3: Explicit session context
print("\n=== Test 2: Explicit session context ===")
with ward.SessionContext() as session_id:
    print(f"Started explicit session: {session_id}")

    response3 = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Tell me a joke"}],
    )
    print(f"Response 3: {response3.choices[0].message.content[:50]}...")

    response4 = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Tell me another one"}],
    )
    print(f"Response 4: {response4.choices[0].message.content[:50]}...")

print("\n=== Test 3: New session after context ===")
response5 = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "What's 2+2?"}],
)
print(f"Response 5: {response5.choices[0].message.content[:50]}...")

print("\nAll tests completed! Check the dashboard at /traces to see sessions grouped correctly.")