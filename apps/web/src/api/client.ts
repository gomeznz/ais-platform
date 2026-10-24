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
      // Only send a JSON content-type when there's actually a body (e.g.
      // DELETE calls have none) — Fastify's default JSON parser rejects
      // an empty body sent with "Content-Type: application/json"
      // (FST_ERR_CTP_EMPTY_JSON_BODY), which was breaking every delete.
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
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

export interface AuthUser {
  id: string;
  email: string;
  role: "owner" | "admin" | "member";
  isPlatformAdmin: boolean;
}

export interface AuthTenant {
  id: string;
  name: string;
  slug: string;
}

interface AuthResponse {
  token: string;
  user: AuthUser;
  tenant: AuthTenant;
  mustChangePassword: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  role: "owner" | "admin" | "member";
  status: "active" | "disabled";
  is_platform_admin?: boolean;
  must_change_password?: boolean;
  created_at: string;
  tenant_id?: string;
  tenant_name?: string;
  tenant_slug?: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  user_count: number;
  fleet_count: number;
  receiver_count: number;
}

export type ReceiverKind = "tcp_client" | "http_polling" | "websocket";

export interface Receiver {
  id: string;
  name: string;
  kind: ReceiverKind;
  config: Record<string, unknown>;
  enabled: boolean;
  status: "unknown" | "connecting" | "connected" | "error" | "disabled";
  status_message: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export const api = {
  register: (organizationName: string, email: string, password: string) =>
    request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ organizationName, email, password }),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/auth/change-password", {
      method: "POST",
      token,
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // --- Tenant admin: users & receivers (optionally ?tenantId= for a platform admin) ---

  listUsers: (token: string, tenantId?: string) =>
    request<{ users: AdminUser[] }>(`/admin/users${tenantId ? `?tenantId=${tenantId}` : ""}`, { token }),

  createUser: (token: string, email: string, role: string, tenantId?: string) =>
    request<{ user: AdminUser; tempPassword: string }>(
      `/admin/users${tenantId ? `?tenantId=${tenantId}` : ""}`,
      { method: "POST", token, body: JSON.stringify({ email, role }) }
    ),

  updateUser: (
    token: string,
    userId: string,
    updates: { role?: string; status?: string },
    tenantId?: string
  ) =>
    request<{ user: AdminUser }>(`/admin/users/${userId}${tenantId ? `?tenantId=${tenantId}` : ""}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(updates),
    }),

  resetUserPassword: (token: string, userId: string, tenantId?: string) =>
    request<{ ok: true; tempPassword: string }>(
      `/admin/users/${userId}/reset-password${tenantId ? `?tenantId=${tenantId}` : ""}`,
      { method: "POST", token }
    ),

  deleteUser: (token: string, userId: string, tenantId?: string) =>
    request<void>(`/admin/users/${userId}${tenantId ? `?tenantId=${tenantId}` : ""}`, {
      method: "DELETE",
      token,
    }),

  listReceivers: (token: string, tenantId?: string) =>
    request<{ receivers: Receiver[] }>(`/admin/receivers${tenantId ? `?tenantId=${tenantId}` : ""}`, {
      token,
    }),

  createReceiver: (
    token: string,
    name: string,
    kind: ReceiverKind,
    config: Record<string, unknown>,
    tenantId?: string
  ) =>
    request<{ receiver: Receiver }>(`/admin/receivers${tenantId ? `?tenantId=${tenantId}` : ""}`, {
      method: "POST",
      token,
      body: JSON.stringify({ name, kind, config }),
    }),

  updateReceiver: (
    token: string,
    receiverId: string,
    updates: { name?: string; config?: Record<string, unknown>; enabled?: boolean },
    tenantId?: string
  ) =>
    request<{ receiver: Receiver }>(
      `/admin/receivers/${receiverId}${tenantId ? `?tenantId=${tenantId}` : ""}`,
      { method: "PATCH", token, body: JSON.stringify(updates) }
    ),

  deleteReceiver: (token: string, receiverId: string, tenantId?: string) =>
    request<void>(`/admin/receivers/${receiverId}${tenantId ? `?tenantId=${tenantId}` : ""}`, {
      method: "DELETE",
      token,
    }),

  // --- Platform admin: cross-tenant ---

  listTenants: (token: string) => request<{ tenants: Tenant[] }>("/platform/tenants", { token }),

  createTenant: (token: string, name: string, ownerEmail: string) =>
    request<{ tenant: Tenant; owner: AdminUser; tempPassword: string }>("/platform/tenants", {
      method: "POST",
      token,
      body: JSON.stringify({ name, ownerEmail }),
    }),

  listAllUsers: (token: string) => request<{ users: AdminUser[] }>("/platform/users", { token }),

  setPlatformAdmin: (token: string, userId: string, isPlatformAdmin: boolean) =>
    request<{ user: AdminUser }>(`/platform/users/${userId}/platform-admin`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ isPlatformAdmin }),
    }),

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
