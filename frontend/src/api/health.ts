export type HealthResponse = {
  ok: boolean;
  database: { ok: boolean };
  seed: { ok: boolean; email: string };
};

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health");

  if (!response.ok) {
    throw new Error(`Health request failed: ${response.status}`);
  }

  return response.json() as Promise<HealthResponse>;
}
