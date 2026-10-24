import { useState, type FormEvent } from "react";
import { useAuth } from "../state/auth.js";

/** Shown instead of the dashboard when an admin-created/reset account hasn't picked its own password yet. */
export function ChangePassword() {
  const { changePassword, logout, user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match");
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Set a new password</h1>
        <p className="muted">
          {user?.email} was given a temporary password. Choose your own before continuing.
        </p>

        <label>
          Temporary password
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label>
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>

        {error && <div className="error-banner">{error}</div>}

        <button type="submit" disabled={busy}>
          Set password
        </button>
        <button type="button" className="link-button" onClick={logout}>
          Sign out
        </button>
      </form>
    </div>
  );
}
