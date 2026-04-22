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
    throw new Error(await response.text());
  }

  const json = (await response.json()) as { data: T };
  return json.data;
}
