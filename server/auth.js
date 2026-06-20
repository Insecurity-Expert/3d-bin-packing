// server/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const COOKIE = "stackr_token";

function sign(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authRequired(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "Not signed in" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid session" });
  }
}

router.post("/register", (req, res) => {
  const { email, name, password, role } = req.body || {};
  if (!email || !name || !password)
    return res.status(400).json({ error: "email, name, password required" });
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (exists) return res.status(409).json({ error: "Email already registered" });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO users (email, name, role, pass_hash) VALUES (?,?,?,?)")
    .run(email, name, role || "researcher", hash);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);

  res
    .cookie(COOKIE, sign(user), { httpOnly: true, sameSite: "lax", maxAge: 7 * 864e5 })
    .json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !bcrypt.compareSync(password, user.pass_hash))
    return res.status(401).json({ error: "Wrong email or password" });

  res
    .cookie(COOKIE, sign(user), { httpOnly: true, sameSite: "lax", maxAge: 7 * 864e5 })
    .json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE).json({ ok: true });
});

router.get("/me", authRequired, (req, res) => {
  const u = db.prepare("SELECT id,email,name,role,created_at FROM users WHERE id = ?")
    .get(req.user.id);
  res.json(u);
});

router.get("/runs", authRequired, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM runs WHERE user_id = ? ORDER BY id DESC LIMIT 100")
    .all(req.user.id);
  res.json(rows);
});

router.post("/runs", authRequired, (req, res) => {
  const r = req.body || {};
  const info = db
    .prepare(`INSERT INTO runs
      (user_id, strategy, instance, n_items, space_util, dissipation, runtime_s, bins_used)
      VALUES (?,?,?,?,?,?,?,?)`)
    .run(req.user.id, r.strategy, r.instance, r.n_items, r.space_util,
         r.dissipation, r.runtime_s, r.bins_used);
  res.json({ id: info.lastInsertRowid });
});

module.exports = { router, authRequired };