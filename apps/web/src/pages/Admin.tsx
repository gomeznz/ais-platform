import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../state/auth.js";
import {
  api,
  type AdminUser,
  type Receiver,
  type ReceiverEvent,
  type ReceiverKind,
  type Tenant,
} from "../api/client.js";

type Tab = "users" | "receivers" | "organizations";

interface AdminProps {
  onBack: () => void;
}

export function Admin({ onBack }: AdminProps) {
  const { token, user, tenant } = useAuth();
  const isPlatformAdmin = !!user?.isPlatformAdmin;
  const [tab, setTab] = useState<Tab>("users");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [actingTenantId, setActingTenantId] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  const loadTenants = useCallback(async () => {
    if (!token || !isPlatformAdmin) return;
    const { tenants: loaded } = await api.listTenants(token);
    setTenants(loaded);
  }, [token, isPlatformAdmin]);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  return (
    <div className="dashboard">
      <header className="topbar">
        <div>
          <strong>{tenant?.name}</strong> <span className="muted">— Admin</span>
        </div>
        <div>
          <button className="link-button" onClick={onBack}>
            Back to map
          </button>
        </div>
      </header>

      <div className="admin-body">
        <nav className="admin-tabs">
          <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>
            Users
          </button>
          <button className={tab === "receivers" ? "active" : ""} onClick={() => setTab("receivers")}>
            Receivers
          </button>
          {isPlatformAdmin && (
            <button
              className={tab === "organizations" ? "active" : ""}
              onClick={() => setTab("organizations")}
            >
              Organizations (all tenants)
            </button>
          )}
        </nav>

        {isPlatformAdmin && tab !== "organizations" && (
          <div className="admin-tenant-picker">
            <span className="muted">Managing:</span>
            <select
              value={actingTenantId ?? ""}
              onChange={(e) => setActingTenantId(e.target.value || undefined)}
            >
              <option value="">{tenant?.name} (your org)</option>
              {tenants
                .filter((t) => t.id !== tenant?.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        {notice && (
          <div className="notice-banner">
            {notice}
            <button className="link-button" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}

        {tab === "users" && <UsersPanel tenantId={actingTenantId} setNotice={setNotice} />}
        {tab === "receivers" && <ReceiversPanel tenantId={actingTenantId} setNotice={setNotice} />}
        {tab === "organizations" && isPlatformAdmin && (
          <OrganizationsPanel tenants={tenants} onChanged={loadTenants} setNotice={setNotice} />
        )}
      </div>
    </div>
  );
}

// --- Users -------------------------------------------------------------

function UsersPanel({
  tenantId,
  setNotice,
}: {
  tenantId: string | undefined;
  setNotice: (msg: string | null) => void;
}) {
  const { token, user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const { users: loaded } = await api.listUsers(token, tenantId);
    setUsers(loaded);
  }, [token, tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!token || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { tempPassword } = await api.createUser(token, email.trim(), role, tenantId);
      setEmail("");
      setRole("member");
      await load();
      setNotice(`Created ${email.trim()} — temporary password: ${tempPassword}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRoleChange(u: AdminUser, newRole: string) {
    if (!token) return;
    try {
      await api.updateUser(token, u.id, { role: newRole }, tenantId);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleStatusToggle(u: AdminUser) {
    if (!token) return;
    const nextStatus = u.status === "active" ? "disabled" : "active";
    try {
      await api.updateUser(token, u.id, { status: nextStatus }, tenantId);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleResetPassword(u: AdminUser) {
    if (!token) return;
    try {
      const { tempPassword } = await api.resetUserPassword(token, u.id, tenantId);
      setNotice(`New temporary password for ${u.email}: ${tempPassword}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(u: AdminUser) {
    if (!token) return;
    if (!window.confirm(`Remove ${u.email}? This can't be undone.`)) return;
    try {
      await api.deleteUser(token, u.id, tenantId);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Flags</th>
              <th className="admin-actions-col"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>
                  <select value={u.role} onChange={(e) => handleRoleChange(u, e.target.value)}>
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                    <option value="owner">owner</option>
                  </select>
                </td>
                <td>
                  <span className={`badge ${u.status === "active" ? "badge-ok" : "badge-off"}`}>
                    {u.status}
                  </span>
                </td>
                <td>
                  {u.is_platform_admin && <span className="badge badge-accent">platform admin</span>}{" "}
                  {u.must_change_password && <span className="badge">pending password</span>}
                </td>
                <td className="admin-row-actions admin-actions-col">
                  <button className="link-button" onClick={() => handleResetPassword(u)}>
                    Reset password
                  </button>
                  <button className="link-button" onClick={() => handleStatusToggle(u)}>
                    {u.status === "active" ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="link-button danger"
                    onClick={() => handleDelete(u)}
                    disabled={u.id === currentUser?.id}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-hint">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form className="admin-form" onSubmit={handleCreate}>
        <h3>Add a user</h3>
        <div className="inline-form">
          <input
            type="email"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="member">member</option>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </select>
          <button type="submit" disabled={busy}>
            Add user
          </button>
        </div>
        <p className="muted">
          A temporary password is generated and shown once — the new user must change it on first login.
        </p>
        {error && <div className="error-banner">{error}</div>}
      </form>
    </div>
  );
}

// --- Receivers -----------------------------------------------------------

interface ReceiverConfigFields {
  host: string;
  port: string;
  provider: "generic" | "aistrail";
  url: string;
  apiToken: string;
  intervalMs: string;
  wsApiKey: string;
  bboxLat1: string;
  bboxLon1: string;
  bboxLat2: string;
  bboxLon2: string;
  mmsiFilter: string;
}

/** Shared by the add-receiver form and the inline edit form so the two never drift apart. */
function buildReceiverConfig(kind: ReceiverKind, f: ReceiverConfigFields): Record<string, unknown> {
  if (kind === "tcp_client") return { host: f.host.trim(), port: Number(f.port) };
  if (kind === "websocket") {
    return {
      apiKey: f.wsApiKey.trim(),
      boundingBoxes: [[[Number(f.bboxLat1), Number(f.bboxLon1)], [Number(f.bboxLat2), Number(f.bboxLon2)]]],
      mmsiFilter: f.mmsiFilter.trim()
        ? f.mmsiFilter
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean)
        : undefined,
    };
  }
  return { url: f.url.trim(), token: f.apiToken.trim() || undefined, intervalMs: Number(f.intervalMs), provider: f.provider };
}

function ReceiversPanel({
  tenantId,
  setNotice,
}: {
  tenantId: string | undefined;
  setNotice: (msg: string | null) => void;
}) {
  const { token } = useAuth();
  const [receivers, setReceivers] = useState<Receiver[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ReceiverKind>("tcp_client");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [provider, setProvider] = useState<"generic" | "aistrail">("generic");
  const [url, setUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [intervalMs, setIntervalMs] = useState("15000");
  const [wsApiKey, setWsApiKey] = useState("");
  const [bboxLat1, setBboxLat1] = useState("");
  const [bboxLon1, setBboxLon1] = useState("");
  const [bboxLat2, setBboxLat2] = useState("");
  const [bboxLon2, setBboxLon2] = useState("");
  const [mmsiFilter, setMmsiFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const { receivers: loaded } = await api.listReceivers(token, tenantId);
    setReceivers(loaded);
  }, [token, tenantId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000); // keep status badges fresh
    return () => clearInterval(interval);
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!token || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const config = buildReceiverConfig(kind, {
        host,
        port,
        provider,
        url,
        apiToken,
        intervalMs,
        wsApiKey,
        bboxLat1,
        bboxLon1,
        bboxLat2,
        bboxLon2,
        mmsiFilter,
      });
      await api.createReceiver(token, name.trim(), kind, config, tenantId);
      setName("");
      setHost("");
      setPort("");
      setUrl("");
      setApiToken("");
      setProvider("generic");
      setWsApiKey("");
      setBboxLat1("");
      setBboxLon1("");
      setBboxLat2("");
      setBboxLon2("");
      setMmsiFilter("");
      await load();
      setNotice(`Receiver "${name.trim()}" added — connecting now.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(r: Receiver) {
    if (!token) return;
    try {
      await api.updateReceiver(token, r.id, { enabled: !r.enabled }, tenantId);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(r: Receiver) {
    if (!token) return;
    if (!window.confirm(`Remove receiver "${r.name}"?`)) return;
    try {
      await api.deleteReceiver(token, r.id, tenantId);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function describeConfig(r: Receiver): string {
    if (r.kind === "tcp_client") return `${r.config.host}:${r.config.port}`;
    if (r.kind === "websocket") {
      const boxes = r.config.boundingBoxes as [number, number][][] | undefined;
      return boxes && boxes.length > 0
        ? `bbox ${boxes[0][0].join(",")} → ${boxes[0][1].join(",")}`
        : "aisstream.io";
    }
    return String(r.config.url);
  }

  return (
    <div className="admin-panel">
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Connection</th>
              <th>Status</th>
              <th>Last message</th>
              <th className="admin-actions-col"></th>
            </tr>
          </thead>
          <tbody>
            {receivers.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td>{r.name}</td>
                  <td>
                    {r.kind === "tcp_client"
                      ? "TCP (dial out)"
                      : r.kind === "websocket"
                      ? "WebSocket (aisstream.io)"
                      : `HTTP polling${r.config.provider === "aistrail" ? " (AIS Trail)" : ""}`}
                  </td>
                  <td className="mono truncate" title={describeConfig(r)}>
                    {describeConfig(r)}
                  </td>
                  <td>
                    <span className={`badge ${statusBadgeClass(r)}`}>
                      {r.enabled ? r.status : "disabled"}
                    </span>
                    {r.status_message && <div className="status-message">{r.status_message}</div>}
                  </td>
                  <td>{r.last_message_at ? new Date(r.last_message_at).toLocaleString() : "never"}</td>
                  <td className="admin-row-actions admin-actions-col">
                    <button
                      className="link-button"
                      onClick={() => setEditingId(editingId === r.id ? null : r.id)}
                    >
                      {editingId === r.id ? "Close" : "Edit"}
                    </button>
                    <button
                      className="link-button"
                      onClick={() => setActivityId(activityId === r.id ? null : r.id)}
                    >
                      {activityId === r.id ? "Hide activity" : "Activity"}
                    </button>
                    <button className="link-button" onClick={() => handleToggle(r)}>
                      {r.enabled ? "Disable" : "Enable"}
                    </button>
                    <button className="link-button danger" onClick={() => handleDelete(r)}>
                      Remove
                    </button>
                  </td>
                </tr>
                {editingId === r.id && (
                  <EditReceiverRow
                    receiver={r}
                    tenantId={tenantId}
                    setNotice={setNotice}
                    onCancel={() => setEditingId(null)}
                    onSaved={async () => {
                      setEditingId(null);
                      await load();
                    }}
                  />
                )}
                {activityId === r.id && <ReceiverActivityRow receiver={r} tenantId={tenantId} />}
              </Fragment>
            ))}
            {receivers.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-hint">
                  No receivers configured yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form className="admin-form" onSubmit={handleCreate}>
        <h3>Add a receiver</h3>
        <div className="inline-form">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <select value={kind} onChange={(e) => setKind(e.target.value as ReceiverKind)}>
            <option value="tcp_client">TCP (dial out to receiver)</option>
            <option value="http_polling">HTTP polling (satellite/aggregator)</option>
            <option value="websocket">WebSocket (aisstream.io)</option>
          </select>
        </div>
        {kind === "tcp_client" ? (
          <div className="inline-form">
            <input placeholder="Host" value={host} onChange={(e) => setHost(e.target.value)} required />
            <input
              placeholder="Port"
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              required
            />
          </div>
        ) : kind === "websocket" ? (
          <>
            <div className="inline-form">
              <input
                placeholder="aisstream.io API key"
                value={wsApiKey}
                onChange={(e) => setWsApiKey(e.target.value)}
                required
              />
            </div>
            <div className="inline-form">
              <input
                placeholder="Lat 1"
                inputMode="decimal"
                value={bboxLat1}
                onChange={(e) => setBboxLat1(e.target.value)}
                required
              />
              <input
                placeholder="Lon 1"
                inputMode="decimal"
                value={bboxLon1}
                onChange={(e) => setBboxLon1(e.target.value)}
                required
              />
              <input
                placeholder="Lat 2"
                inputMode="decimal"
                value={bboxLat2}
                onChange={(e) => setBboxLat2(e.target.value)}
                required
              />
              <input
                placeholder="Lon 2"
                inputMode="decimal"
                value={bboxLon2}
                onChange={(e) => setBboxLon2(e.target.value)}
                required
              />
            </div>
            <div className="inline-form">
              <input
                placeholder="MMSI filter (optional, comma separated)"
                value={mmsiFilter}
                onChange={(e) => setMmsiFilter(e.target.value)}
              />
            </div>
            <p className="muted">
              Free, no plan limits — sign in with GitHub at aisstream.io to get an API key. The bounding box
              is two corners (lat, lon) covering your area of interest.
            </p>
          </>
        ) : (
          <>
            <div className="inline-form">
              <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
                <option value="generic">Generic JSON ({"{ vessels: [...] }"})</option>
                <option value="aistrail">AIS Trail (aistrail.com)</option>
              </select>
            </div>
            <div className="inline-form">
              <input
                placeholder={
                  provider === "aistrail"
                    ? "https://api.aistrail.com/v1/positions?bbox=lat_min,lon_min,lat_max,lon_max&max_age=600"
                    : "https://provider.example/api/positions"
                }
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
              <input
                placeholder={provider === "aistrail" ? "API key (ap_live_...)" : "API token (optional)"}
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                required={provider === "aistrail"}
              />
              <input
                placeholder="Poll ms"
                inputMode="numeric"
                value={intervalMs}
                onChange={(e) => setIntervalMs(e.target.value)}
              />
            </div>
            {provider === "aistrail" && (
              <p className="muted">
                Live positions require AIS Trail's Pro or Business plan, and the bbox in the URL sets which
                area gets polled — see aistrail.com/docs/quickstart.
              </p>
            )}
          </>
        )}
        <div className="inline-form">
          <button type="submit" disabled={busy}>
            Add receiver
          </button>
        </div>
        <p className="muted">
          Terrestrial receivers that push data to us (rather than being dialed) still need a
          deployment-level listen port — ask to have one opened for those.
        </p>
        {error && <div className="error-banner">{error}</div>}
      </form>
    </div>
  );
}

/** Inline edit form for one receiver's config, rendered as an extra table row right below it. Kind is fixed — switching kind entirely changes the config shape, so that still goes through remove + re-add. */
function statusTone(status: ReceiverEvent["status"]): string {
  if (status === "ok") return "badge-ok";
  if (status === "error") return "badge-danger";
  if (status === "dropped") return "badge-pending";
  return "badge-accent";
}

/**
 * Expandable "what's this receiver actually seeing" view — the UI
 * counterpart to pulling the ingest service's logs by hand. Polls while
 * open rather than relying on the table's own 10s refresh, so watching a
 * receiver right after changing its config feels responsive.
 */
function ReceiverActivityRow({
  receiver,
  tenantId,
}: {
  receiver: Receiver;
  tenantId: string | undefined;
}) {
  const { token } = useAuth();
  const [events, setEvents] = useState<ReceiverEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { events: loaded } = await api.getReceiverEvents(token, receiver.id, tenantId, 50);
        if (!cancelled) setEvents(loaded);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };
    load();
    const interval = setInterval(load, 4_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token, receiver.id, tenantId]);

  return (
    <tr className="admin-activity-row">
      <td colSpan={6}>
        <div className="admin-activity-panel">
          <div className="admin-activity-header">
            <strong>Recent activity — {receiver.name}</strong>
            <span className="muted">refreshes every few seconds</span>
          </div>
          {error && <div className="error-banner">{error}</div>}
          {!error && events.length === 0 && (
            <div className="empty-hint">
              No diagnostic events yet. Either no traffic has arrived since this receiver last connected, or
              this receiver kind doesn't log detailed activity (currently only the WebSocket/aisstream.io kind
              does).
            </div>
          )}
          {events.length > 0 && (
            <div className="admin-activity-log">
              {events.map((ev) => (
                <div key={ev.id} className="admin-activity-line">
                  <span className="mono muted">{new Date(ev.ts).toLocaleTimeString()}</span>
                  <span className={`badge ${statusTone(ev.status)}`}>{ev.kind}</span>
                  {ev.message_type && <span className="mono">{ev.message_type}</span>}
                  {ev.mmsi !== null && <span className="mono">mmsi {ev.mmsi}</span>}
                  {ev.detail && (
                    <span className="admin-activity-detail mono" title={ev.detail}>
                      {ev.detail}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function EditReceiverRow({
  receiver,
  tenantId,
  setNotice,
  onCancel,
  onSaved,
}: {
  receiver: Receiver;
  tenantId: string | undefined;
  setNotice: (msg: string | null) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const existingBox = (receiver.config.boundingBoxes as [number, number][][] | undefined)?.[0];

  const [name, setName] = useState(receiver.name);
  const [host, setHost] = useState(String(receiver.config.host ?? ""));
  const [port, setPort] = useState(receiver.config.port !== undefined ? String(receiver.config.port) : "");
  const [provider, setProvider] = useState<"generic" | "aistrail">(
    receiver.config.provider === "aistrail" ? "aistrail" : "generic"
  );
  const [url, setUrl] = useState(String(receiver.config.url ?? ""));
  const [apiToken, setApiToken] = useState(String(receiver.config.token ?? ""));
  const [intervalMs, setIntervalMs] = useState(
    receiver.config.intervalMs !== undefined ? String(receiver.config.intervalMs) : "15000"
  );
  const [wsApiKey, setWsApiKey] = useState(String(receiver.config.apiKey ?? ""));
  const [bboxLat1, setBboxLat1] = useState(existingBox ? String(existingBox[0][0]) : "");
  const [bboxLon1, setBboxLon1] = useState(existingBox ? String(existingBox[0][1]) : "");
  const [bboxLat2, setBboxLat2] = useState(existingBox ? String(existingBox[1][0]) : "");
  const [bboxLon2, setBboxLon2] = useState(existingBox ? String(existingBox[1][1]) : "");
  const [mmsiFilter, setMmsiFilter] = useState(
    Array.isArray(receiver.config.mmsiFilter) ? (receiver.config.mmsiFilter as string[]).join(", ") : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!token || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const config = buildReceiverConfig(receiver.kind, {
        host,
        port,
        provider,
        url,
        apiToken,
        intervalMs,
        wsApiKey,
        bboxLat1,
        bboxLon1,
        bboxLat2,
        bboxLon2,
        mmsiFilter,
      });
      await api.updateReceiver(token, receiver.id, { name: name.trim(), config }, tenantId);
      setNotice(`Receiver "${name.trim()}" updated.`);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="admin-edit-row">
      <td colSpan={6}>
        <form className="admin-form admin-edit-form" onSubmit={handleSave}>
          <div className="inline-form">
            <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
            <span className="muted">
              {receiver.kind === "tcp_client"
                ? "TCP (dial out) — kind can't be changed; remove and re-add to switch"
                : receiver.kind === "websocket"
                ? "WebSocket (aisstream.io) — kind can't be changed; remove and re-add to switch"
                : "HTTP polling — kind can't be changed; remove and re-add to switch"}
            </span>
          </div>
          {receiver.kind === "tcp_client" ? (
            <div className="inline-form">
              <input placeholder="Host" value={host} onChange={(e) => setHost(e.target.value)} required />
              <input
                placeholder="Port"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                required
              />
            </div>
          ) : receiver.kind === "websocket" ? (
            <>
              <div className="inline-form">
                <input
                  placeholder="aisstream.io API key"
                  value={wsApiKey}
                  onChange={(e) => setWsApiKey(e.target.value)}
                  required
                />
              </div>
              <div className="inline-form">
                <input
                  placeholder="Lat 1"
                  inputMode="decimal"
                  value={bboxLat1}
                  onChange={(e) => setBboxLat1(e.target.value)}
                  required
                />
                <input
                  placeholder="Lon 1"
                  inputMode="decimal"
                  value={bboxLon1}
                  onChange={(e) => setBboxLon1(e.target.value)}
                  required
                />
                <input
                  placeholder="Lat 2"
                  inputMode="decimal"
                  value={bboxLat2}
                  onChange={(e) => setBboxLat2(e.target.value)}
                  required
                />
                <input
                  placeholder="Lon 2"
                  inputMode="decimal"
                  value={bboxLon2}
                  onChange={(e) => setBboxLon2(e.target.value)}
                  required
                />
              </div>
              <div className="inline-form">
                <input
                  placeholder="MMSI filter (optional, comma separated)"
                  value={mmsiFilter}
                  onChange={(e) => setMmsiFilter(e.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <div className="inline-form">
                <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
                  <option value="generic">Generic JSON ({"{ vessels: [...] }"})</option>
                  <option value="aistrail">AIS Trail (aistrail.com)</option>
                </select>
              </div>
              <div className="inline-form">
                <input
                  placeholder={
                    provider === "aistrail"
                      ? "https://api.aistrail.com/v1/positions?bbox=lat_min,lon_min,lat_max,lon_max&max_age=600"
                      : "https://provider.example/api/positions"
                  }
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
                <input
                  placeholder={provider === "aistrail" ? "API key (ap_live_...)" : "API token (optional)"}
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  required={provider === "aistrail"}
                />
                <input
                  placeholder="Poll ms"
                  inputMode="numeric"
                  value={intervalMs}
                  onChange={(e) => setIntervalMs(e.target.value)}
                />
              </div>
            </>
          )}
          <div className="inline-form">
            <button type="submit" disabled={busy}>
              Save
            </button>
            <button type="button" className="link-button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          </div>
          {error && <div className="error-banner">{error}</div>}
        </form>
      </td>
    </tr>
  );
}

function statusBadgeClass(r: Receiver): string {
  if (!r.enabled) return "badge-off";
  if (r.status === "connected") return "badge-ok";
  if (r.status === "error") return "badge-danger";
  return "badge-pending";
}

// --- Organizations (platform admin) --------------------------------------

function OrganizationsPanel({
  tenants,
  onChanged,
  setNotice,
}: {
  tenants: Tenant[];
  onChanged: () => void;
  setNotice: (msg: string | null) => void;
}) {
  const { token } = useAuth();
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!token || !name.trim() || !ownerEmail.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { tempPassword } = await api.createTenant(token, name.trim(), ownerEmail.trim());
      setName("");
      setOwnerEmail("");
      onChanged();
      setNotice(`Created "${name.trim()}" — owner temporary password: ${tempPassword}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-panel">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Organization</th>
            <th>Users</th>
            <th>Fleets</th>
            <th>Receivers</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{t.user_count}</td>
              <td>{t.fleet_count}</td>
              <td>{t.receiver_count}</td>
              <td>{new Date(t.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
          {tenants.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-hint">
                No organizations yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <form className="admin-form" onSubmit={handleCreate}>
        <h3>Onboard a new organization</h3>
        <div className="inline-form">
          <input
            placeholder="Organization name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            type="email"
            placeholder="Owner email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            required
          />
          <button type="submit" disabled={busy}>
            Create
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
      </form>
    </div>
  );
}
