// client/src/auth/RegisterPage.jsx
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "./AuthContext";

const ROLES = [
  { value: "researcher", label: "Researcher" },
  { value: "logistics", label: "Logistics" },
  { value: "other", label: "Other" },
];

export default function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("researcher");
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    try {
      await register({ email, name, password, role });
      nav("/app");
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: "80px auto", fontFamily: "system-ui" }}>
      <h2>Create account</h2>
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      <input
        placeholder="Full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ width: "100%", padding: 10, margin: "6px 0" }}
      />
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

      <div style={{ margin: "10px 0 4px", fontSize: 13, color: "#555" }}>I am a…</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {ROLES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => setRole(r.value)}
            style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: 6,
              cursor: "pointer",
              border: role === r.value ? "2px solid #6366f1" : "1px solid #ccc",
              background: role === r.value ? "#eef2ff" : "#fff",
              fontWeight: role === r.value ? 600 : 400,
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <button onClick={submit} style={{ width: "100%", padding: 10 }}>
        Create account
      </button>
      <p>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}