export interface Env {
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  GOOGLE_API_KEY: string;
  NVIDIA_API_KEY: string;
}

const PROXY_CONFIG: Record<string, { baseUrl: string; authKey: keyof Env }> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    authKey: "OPENAI_API_KEY",
  },
  claude: {
    baseUrl: "https://api.anthropic.com/v1",
    authKey: "ANTHROPIC_API_KEY",
  },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    authKey: "GOOGLE_API_KEY",
  },
  nvidia: {
    baseUrl: "https://integrate.api.nvidia.com",
    authKey: "NVIDIA_API_KEY",
  },
};

async function proxyRequest(path: string, request: Request, config: { baseUrl: string; authKey: string }, env: Env) {
  const targetUrl = `${config.baseUrl}${path}`;
  const apiKey = env[config.authKey];

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API key not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);

  // Remove hop-by-hop headers
  headers.delete("Transfer-Encoding");
  headers.delete("Connection");
  headers.delete("Keep-Alive");
  headers.delete("Te");
  headers.delete("Trailer");
  headers.delete("Upgrade");
  // Prevent CF from double-compressing the response
  headers.delete("Accept-Encoding");

  // Claude requires a version header
  if (config.authKey === "ANTHROPIC_API_KEY") {
    headers.set("x-api-key", apiKey);
    if (!headers.has("anthropic-version")) {
      headers.set("anthropic-version", "2023-06-01");
    }
  }

  const body = request.body ? await request.arrayBuffer() : null;

  const response = await fetch(targetUrl, {
    method: request.method,
    headers,
    body,
  });

  const responseBody = await response.arrayBuffer();

  const newHeaders = new Headers(response.headers);
  newHeaders.delete("transfer-encoding");
  newHeaders.delete("content-encoding");

  return new Response(responseBody, {
    status: response.status,
    headers: newHeaders,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Extract provider from first path segment
    const segments = url.pathname.split("/").filter(Boolean);
    const provider = segments[0];

    const config = PROXY_CONFIG[provider];
    if (!config) {
      return new Response(
        JSON.stringify({
          error: `Unknown provider '${provider}'. Supported: ${Object.keys(PROXY_CONFIG).join(", ")}`,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Remaining path + query for upstream request
    const remainingPath = "/" + segments.slice(1).join("/") + url.search;

    try {
      return await proxyRequest(remainingPath, request, config, env);
    } catch (err) {
      return new Response(JSON.stringify({ error: "Upstream request failed", detail: String(err) }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
