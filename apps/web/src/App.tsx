import { AuthProvider, useAuth } from "./state/auth.js";
import { Login } from "./pages/Login.js";
import { Dashboard } from "./pages/Dashboard.js";

function Screen() {
  const { token } = useAuth();
  return token ? <Dashboard /> : <Login />;
}

export function App() {
  return (
    <AuthProvider>
      <Screen />
    </AuthProvider>
  );
}
