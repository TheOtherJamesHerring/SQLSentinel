const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";

function token() {
  return localStorage.getItem("sqls_token") ?? "";
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token()}`,
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const raw = await response.text();
    let message = raw;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { message?: unknown; error?: unknown; details?: unknown };
        const fromPayload = [parsed.message, parsed.error, parsed.details]
          .find((value) => typeof value === "string" && value.trim()) as string | undefined;
        if (fromPayload) {
          message = fromPayload;
        }
      } catch {
        // Keep raw text if not JSON.
      }
    }

    if (!message || !message.trim()) {
      message = `Request failed (${response.status} ${response.statusText})`;
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const json = (await response.json()) as { data: T };
  return json.data;
}
