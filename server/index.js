const express   = require("express");
const cors      = require("cors");
const fs        = require("fs");
const path      = require("path");
const { spawn } = require("child_process");
const readline  = require("readline");
const WebSocket = require("ws");
const cookieParser = require("cookie-parser");
const { router: authRouter } = require("./auth");

const app     = express();
const PORT    = 3001;
const WS_PORT = 3002;

const DATA_ROOT = path.join(__dirname, "..", "data", "CLP-Datasets-Main", "BR");
const OPTIMIZER = path.join(__dirname, "..", "optimizer", "main_optimizer.py");

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRouter);

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket server (port 3002)
//
// Each client connection owns its own Python child process.
// Protocol (client → server):
//   { action: "run",  instancePath: "<abs path>", maxTime?: 90 }
//   { action: "stop" }
//
// Protocol (server → client, each message is a JSON line from Python or a
// synthetic control message):
//   { type: "instance_info",    container, n_items, lower_bound }
//   { type: "iteration_update", iteration, max_iter, best_bins,
//           best_dissipation, best_composite, temperature,
//           last_udhc, udhc_accepted, solution:[...] }
//   { type: "integration_applied", bins_reduced_by, new_bins }
//   { type: "instance_complete", bins_used, lower_bound, gap_pct,
//           dissipation, composite_score, volume_util_pct, runtime_s,
//           container, n_items, items:[...] }
//   { type: "stopped" }
//   { type: "error",       error: "..." }
//   { type: "run_closed",  code: 0|1 }
// ─────────────────────────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ port: WS_PORT });

wss.on("connection", (ws) => {
  console.log("WS client connected");
  let childProc = null;

  function send(obj) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function killChild() {
    if (childProc) {
      try { childProc.kill("SIGTERM"); } catch {}
      childProc = null;
    }
  }

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.action === "run") {
      killChild(); // abort any prior run for this connection

      const instancePath = msg.instancePath;
      if (!instancePath) {
        send({ type: "error", error: "instancePath required" });
        return;
      }

      const norm = path.resolve(instancePath);
      if (!norm.startsWith(path.resolve(DATA_ROOT))) {
        send({ type: "error", error: "Path outside data directory" });
        return;
      }
      if (!fs.existsSync(norm)) {
        send({ type: "error", error: "File not found" });
        return;
      }

      const maxTime = Math.min(Number(msg.maxTime) || 90, 300);

      childProc = spawn(
        "python",
        [OPTIMIZER, norm, "--stream", "--max-time", String(maxTime)],
        { env: { ...process.env, PYTHONMALLOC: "malloc" } }
      );

      const rl = readline.createInterface({ input: childProc.stdout, crlfDelay: Infinity });
      rl.on("line", (line) => {
        const t = line.trim();
        if (!t) return;
        try { send(JSON.parse(t)); } catch {}
      });

      childProc.stderr.on("data", (chunk) => process.stdout.write(chunk));

      childProc.on("close", (code) => {
        rl.close();
        send({ type: "run_closed", code });
        childProc = null;
      });

      childProc.on("error", (err) => {
        send({ type: "error", error: err.message });
        childProc = null;
      });
    }

    if (msg.action === "stop") {
      killChild();
      send({ type: "stopped" });
    }
  });

  ws.on("close", () => {
    console.log("WS client disconnected");
    killChild();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/instances
// Returns all BR dataset instances grouped by set (BR0–BR18).
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/instances", (req, res) => {
  try {
    const instances = [];
    const sets = fs.readdirSync(DATA_ROOT)
      .filter((n) => fs.statSync(path.join(DATA_ROOT, n)).isDirectory())
      .sort((a, b) => parseInt(a.replace("BR", "")) - parseInt(b.replace("BR", "")));

    for (const setName of sets) {
      const setPath = path.join(DATA_ROOT, setName);
      const files   = fs.readdirSync(setPath)
        .filter((f) => f.endsWith(".json"))
        .sort((a, b) => parseInt(a) - parseInt(b));

      for (const file of files) {
        instances.push({
          set:   setName,
          file,
          label: `${setName} / ${file}`,
          path:  path.join(setPath, file),
        });
      }
    }
    res.json({ count: instances.length, instances });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  HTTP API  →  http://localhost:${PORT}`);
  console.log(`✅  WebSocket →  ws://localhost:${WS_PORT}`);
  console.log(`    Dataset   →  ${DATA_ROOT}\n`);
});
