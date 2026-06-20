// client/src/auth/LoginPage.jsx
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    try {
      await login(email, password);
      nav("/app");
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: "80px auto", fontFamily: "system-ui" }}>
      <h2>Sign in</h2>
      {err && <p style={{ color: "crimson" }}>{err}</p>}
      <input
        placeholder="researcher@pup.edu.ph"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: "100%", padding: 10, margin: "6px 0" }}
      />
      <input
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: "100%", padding: 10, margin: "6px 0" }}
      />
      <button onClick={submit} style={{ width: "100%", padding: 10 }}>
        Sign in
      </button>
      <p>
        No account? <Link to="/register">Register</Link>
      </p>
    </div>
  );
}