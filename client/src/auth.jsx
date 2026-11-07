import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, bootstrapCsrf, setAccessToken } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const accept = useCallback(async (result) => {
    setAccessToken(result.accessToken);
    setUser(result.user || await api("/auth/me"));
    return result.user;
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      await bootstrapCsrf();
      try {
        const session = await api("/auth/refresh", { method: "POST", body: JSON.stringify({}) });
        if (!active) return;
        setAccessToken(session.accessToken);
        setUser(await api("/auth/me"));
      } catch { setAccessToken(null); }
      finally { if (active) setReady(true); }
    })();
    return () => { active = false; };
  }, []);

  const login = useCallback(async (email, password) => accept(await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })), [accept]);
  const register = useCallback(async (name, email, password) => accept(await api("/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) })), [accept]);
  const logout = useCallback(async () => {
    try { await api("/auth/logout", { method: "POST", body: JSON.stringify({}) }); }
    finally { setAccessToken(null); setUser(null); }
  }, []);

  return <AuthContext.Provider value={{ user, ready, login, register, logout, setUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
