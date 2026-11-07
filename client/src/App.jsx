import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import { AuthPage } from "./pages/AuthPage.jsx";
import { Dashboard } from "./pages/Dashboard.jsx";
import { Library } from "./pages/Library.jsx";
import { Research } from "./pages/Research.jsx";
import { Shell } from "./shell.jsx";

function Gate({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="boot-screen"><img className="brand-logo boot-brand-logo" src="/papertrail-ai-logo.svg" alt="Papertrail"/><p>Opening your workspace…</p></div>;
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const { user } = useAuth();
  return <Routes>
    <Route path="/login" element={user ? <Navigate to="/" replace /> : <AuthPage mode="login" />} />
    <Route path="/register" element={user ? <Navigate to="/" replace /> : <AuthPage mode="register" />} />
    <Route path="/" element={<Gate><Shell /></Gate>}>
      <Route index element={<Dashboard />} />
      <Route path="library" element={<Library />} />
      <Route path="research" element={<Research />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
