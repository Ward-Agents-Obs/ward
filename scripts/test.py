import ward
from openai import OpenAI
from dotenv import get_key, find_dotenv, load_dotenv

load_dotenv()

ward.init(
      application_name="my-app",
      otlp_endpoint="http://localhost:8080",
      otlp_headers={"Authorization": "Bearer ak_live_be098ecd94b91e6722c3d36452a5da96"},
)

client = OpenAI(api_key=get_key(find_dotenv(), "OPENAI_API_KEY"))
client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hello world!"}],
)