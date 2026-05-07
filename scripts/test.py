import os
import ward
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

ward_api_key = os.environ["WARD_API_KEY"]

ward.init(
      application_name="my-app",
      otlp_endpoint="http://localhost:8080",
      otlp_headers={"Authorization": f"Bearer {ward_api_key}"},
)

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hello world!"}],
)