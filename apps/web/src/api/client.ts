export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? `Request failed with status ${res.status}`);
  }
  return body as T;
}

export interface Fleet {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  vessel_count?: number;
}

export interface FleetVessel {
  mmsi: number;
  ship_name: string | null;
  call_sign: string | null;
  ship_type_text: string | null;
  label: string | null;
  ts: string | null;
  lon: number | null;
  lat: number | null;
  sog: number | null;
  cog: number | null;
  true_heading: number | null;
  nav_status: number | null;
  source: string | null;
}

export const api = {
  register: (organizationName: string, email: string, password: string) =>
    request<{ token: string; user: { id: string; email: string; role: string }; tenant: { id: string; name: string; slug: string } }>(
      "/auth/register",
      { method: "POST", body: JSON.stringify({ organizationName, email, password }) }
    ),

  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; email: string; role: string }; tenant: { id: string; name: string; slug: string } }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) }
    ),

  listFleets: (token: string) => request<{ fleets: Fleet[] }>("/fleets", { token }),

  createFleet: (token: string, name: string, description?: string, color?: string) =>
    request<{ fleet: Fleet }>("/fleets", {
      method: "POST",
      token,
      body: JSON.stringify({ name, description, color }),
    }),

  deleteFleet: (token: string, fleetId: string) =>
    request<void>(`/fleets/${fleetId}`, { method: "DELETE", token }),

  fleetPositions: (token: string, fleetId: string) =>
    request<{ positions: FleetVessel[] }>(`/fleets/${fleetId}/positions`, { token }),

  addVesselToFleet: (token: string, fleetId: string, mmsi: number, label?: string) =>
    request<{ ok: true }>(`/fleets/${fleetId}/vessels`, {
      method: "POST",
      token,
      body: JSON.stringify({ mmsi, label }),
    }),

  removeVesselFromFleet: (token: string, fleetId: string, mmsi: number) =>
    request<void>(`/fleets/${fleetId}/vessels/${mmsi}`, { method: "DELETE", token }),
};
