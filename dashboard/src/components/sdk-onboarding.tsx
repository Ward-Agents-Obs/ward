"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink, PlayCircle } from "lucide-react";
import Link from "next/link";

interface SdkOnboardingProps {
  projectSlug: string;
  apiKey?: string;
}

export function SdkOnboarding({ apiKey }: SdkOnboardingProps) {
  const [activeTab, setActiveTab] = useState("python");
  const [copiedCode, setCopiedCode] = useState(false);

  const otlpEndpoint = process.env.NODE_ENV === "production"
    ? "https://api.ward.dev/v1/otlp"
    : "http://localhost:4318";

  const codeExamples = {
    python: `# Install Ward SDK
pip install ward-sdk

# Your Python script
import ward
from openai import OpenAI

# Initialize Ward with your API key
ward.init(
    otlp_endpoint="${otlpEndpoint}",
    otlp_headers={"x-api-key": "${apiKey || 'your-api-key-here'}"}
)

# Now all OpenAI calls are automatically traced
client = OpenAI(api_key="your-openai-key")

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello, World!"}]
)

print(response.choices[0].message.content)`,
    nodejs: `// Install Ward SDK
// npm install ward-sdk

// Your Node.js script
import ward from 'ward-sdk';
import OpenAI from 'openai';

// Initialize Ward with your API key
ward.init({
    otlpEndpoint: "${otlpEndpoint}",
    otlpHeaders: {"x-api-key": "${apiKey || 'your-api-key-here'}"}
});

// Now all OpenAI calls are automatically traced
const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{"role": "user", "content": "Hello, World!"}]
});

console.log(response.choices[0].message.content);`
  };

  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(codeExamples[activeTab as keyof typeof codeExamples]);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="rounded-[2rem] border tech-border bg-panel p-8 text-center">
        <div className="mx-auto max-w-3xl">
          <span className="inline-flex items-center rounded-full bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Get Started
          </span>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-foreground">
            Your first Ward SDK call
          </h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            Add Ward to your app in under 60 seconds. Copy the code below, run it, and watch your LLM calls appear in real-time.
          </p>
        </div>
      </div>

      {/* Main Integration Section */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Code Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border">
            {Object.entries(codeExamples).map(([key]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === key
                    ? "border-b-2 border-foreground text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {key === "python" ? "Python" : "Node.js"}
              </button>
            ))}
          </div>

          <div className="relative">
            <pre className="tech-panel overflow-x-auto rounded-xl bg-background p-6 text-sm">
              <code className="text-foreground">
                {codeExamples[activeTab as keyof typeof codeExamples]}
              </code>
            </pre>
            <button
              onClick={handleCopyCode}
              className="absolute right-4 top-4 flex items-center gap-2 rounded-lg bg-panel px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-panel-hover"
            >
              {copiedCode ? (
                <>
                  <Check className="h-3 w-3" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>

        {/* Setup Steps */}
        <div className="space-y-6">
          <div className="rounded-xl border tech-border bg-panel p-6">
            <h3 className="text-lg font-semibold text-foreground">Setup Steps</h3>
            <div className="mt-4 space-y-4">
              {!apiKey && (
                <div className="flex items-start gap-3 rounded-lg bg-yellow-500/10 p-4">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-yellow-500/20 text-xs font-semibold text-yellow-600">
                    1
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Create API Key</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      You&apos;ll need a Ward API key to send traces.
                    </p>
                    <Link
                      href="/settings/keys"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
                    >
                      Create API key
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-xs font-semibold text-blue-600">
                  {!apiKey ? "2" : "1"}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Install & Run</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Copy the code above and run it in your project.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/20 text-xs font-semibold text-green-600">
                  {!apiKey ? "3" : "2"}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Watch Dashboard</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Refresh this page to see your traces and metrics appear.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Test */}
          <div className="rounded-xl border tech-border bg-panel p-6">
            <div className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5 text-foreground" />
              <h3 className="text-lg font-semibold text-foreground">Quick Test</h3>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              The code above includes a simple &quot;Hello, World!&quot; request that will show up immediately in your dashboard.
            </p>
            <div className="mt-4 rounded-lg bg-background/50 p-3">
              <p className="text-xs font-medium text-muted-foreground">Expected output:</p>
              <p className="mt-1 text-sm text-foreground">Hello! How can I help you today?</p>
            </div>
          </div>
        </div>
      </div>

      {/* Environment Variables */}
      <div className="rounded-xl border tech-border bg-panel p-6">
        <h3 className="text-lg font-semibold text-foreground">Environment Variables</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          For production apps, store your API keys as environment variables:
        </p>
        <div className="mt-4 rounded-lg bg-background p-4">
          <code className="text-sm text-foreground">
            WARD_API_KEY={apiKey || "your-ward-api-key"}<br/>
            OPENAI_API_KEY=your-openai-api-key
          </code>
        </div>
      </div>
    </div>
  );
}