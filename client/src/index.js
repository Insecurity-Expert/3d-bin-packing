import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import LoginPage from "./auth/LoginPage";
import RegisterPage from "./auth/RegisterPage";
import App from "./App";

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40 }}>Loading...</div>;
  return user ? children : <Navigate to="/login" replace />;
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/app" element={<Protected><App /></Protected>} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);
