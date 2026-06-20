// client/src/auth/AuthContext.jsx
import React, { createContext, useContext, useEffect, useState } from "react";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error((await r.json()).error || "Login failed");
    setUser(await r.json());
  }

  async function register(payload) {
    const r = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error((await r.json()).error || "Registration failed");
    setUser(await r.json());
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  }

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}