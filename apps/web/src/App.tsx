import { useState } from "react";
import { AuthProvider, useAuth } from "./state/auth.js";
import { Login } from "./pages/Login.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Admin } from "./pages/Admin.js";
import { ChangePassword } from "./pages/ChangePassword.js";

function Screen() {
  const { token, mustChangePassword } = useAuth();
  const [view, setView] = useState<"dashboard" | "admin">("dashboard");

  if (!token) return <Login />;
  if (mustChangePassword) return <ChangePassword />;
  if (view === "admin") return <Admin onBack={() => setView("dashboard")} />;
  return <Dashboard onOpenAdmin={() => setView("admin")} />;
}

export function App() {
  return (
    <AuthProvider>
      <Screen />
    </AuthProvider>
  );
}
