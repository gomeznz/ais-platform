import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../state/auth.js";
import {
  api,
  type AdminUser,
  type Receiver,
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
      <table className="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Flags</th>
            <th></th>
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
              <td className="admin-row-actions">
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const config =
        kind === "tcp_client"
          ? { host: host.trim(), port: Number(port) }
          : {
              url: url.trim(),
              token: apiToken.trim() || undefined,
              intervalMs: Number(intervalMs),
              provider,
            };
      await api.createReceiver(token, name.trim(), kind, config, tenantId);
      setName("");
      setHost("");
      setPort("");
      setUrl("");
      setApiToken("");
      setProvider("generic");
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
    return String(r.config.url);
  }

  return (
    <div className="admin-panel">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Connection</th>
            <th>Status</th>
            <th>Last message</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {receivers.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>
                {r.kind === "tcp_client"
                  ? "TCP (dial out)"
                  : `HTTP polling${r.config.provider === "aistrail" ? " (AIS Trail)" : ""}`}
              </td>
              <td className="mono">{describeConfig(r)}</td>
              <td>
                <span className={`badge ${statusBadgeClass(r)}`}>
                  {r.enabled ? r.status : "disabled"}
                </span>
                {r.status_message && <div className="status-message">{r.status_message}</div>}
              </td>
              <td>{r.last_message_at ? new Date(r.last_message_at).toLocaleString() : "never"}</td>
              <td className="admin-row-actions">
                <button className="link-button" onClick={() => handleToggle(r)}>
                  {r.enabled ? "Disable" : "Enable"}
                </button>
                <button className="link-button danger" onClick={() => handleDelete(r)}>
                  Remove
                </button>
              </td>
            </tr>
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

      <form className="admin-form" onSubmit={handleCreate}>
        <h3>Add a receiver</h3>
        <div className="inline-form">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <select value={kind} onChange={(e) => setKind(e.target.value as ReceiverKind)}>
            <option value="tcp_client">TCP (dial out to receiver)</option>
            <option value="http_polling">HTTP polling (satellite/aggregator)</option>
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
