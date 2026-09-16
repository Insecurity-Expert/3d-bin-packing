// client/src/Shell.jsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "./auth/AuthContext";
import logoImg from "./logo.png";

import LogisticsTab from "./components/LogisticsTab";
import ResultsTab from "./components/ResultsTab";
import VisualizationTab from "./components/VisualizationTab";
import RunHistoryTab from "./components/RunHistoryTab";
import { instancesApi, runsApi } from "./services/api";


// ── MAIN SHELL COMPONENT ──────────────────────────────────────────────────────
export default function Shell() {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");
  const [activeTab, setActiveTab] = useState("logistics"); // logistics, results, visualization, history
  
  // Profile dropdown state
  const [profileOpen, setProfileOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Dataset selection & Loader states
  const [instances, setInstances] = useState([]);
  const [selected, setSelected] = useState("");
  const [loadingList, setLoadingList] = useState(true);

  // Dynamic Custom Configurations
  const [containerSpecs, setContainerSpecs] = useState({ L: 587, H: 233, D: 220 });
  const [maxLoad, setMaxLoad] = useState(28000);
  const [itemsList, setItemsList] = useState([]);       
  const [instanceItems, setInstanceItems] = useState([]); 
  const [isCustomized, setIsCustomized] = useState(false);

  // Algorithm Settings & Constraints
  const [strategy, setStrategy] = useState("Sequential");
  const [maxTime] = useState(90);
  const [wolfSize, setWolfSize] = useState(30);
  const [maxIter, setMaxIter] = useState(500);

  const [fragilityConstraint, setFragilityConstraint] = useState(false);
  const [rotationConstraint, setRotationConstraint] = useState(true);
  const [lifoConstraint, setLifoConstraint] = useState(false);

  // WebSocket & Live optimization run states
  const [wsConnected, setWsConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Stream metrics
  const [instanceInfo, setInstanceInfo] = useState(null);
  const [placements, setPlacements] = useState(null);
  const [binsUsed, setBinsUsed] = useState(0);
  const [chartData, setChartData] = useState([]);
  const [stats, setStats] = useState(null);
  const [finalResult, setFinalResult] = useState(null);
  const [error, setError] = useState(null);

  // Run History
  const [runHistory, setRunHistory] = useState([]);

  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Theme synchronization
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Load instances list
  useEffect(() => {
    instancesApi
      .getAll()
      .then((data) => {
        const list = data.instances || [];
        setInstances(list);
        // Don't auto-select — let the user choose
        setLoadingList(false);
      })
      .catch(() => {
        setError("Cannot reach backend server. Please verify the port 3001.");
        setLoadingList(false);
      });
  }, []);

  // Load selected instance details
  useEffect(() => {
    if (!selected) {
      setInstanceItems([]);   // clear preview when nothing is selected
      return;
    }
    instancesApi
      .getDetails(selected)
      .then((data) => {
        if (data.container) {
          setContainerSpecs({ L: data.container.L, H: data.container.H, D: data.container.D });
        }
        if (data.items) {
          setInstanceItems(data.items);
        }
        setIsCustomized(false);
      })
      .catch(() => {});
  }, [selected]);

  // Fetch Run History
  const fetchRunHistory = useCallback(() => {
    runsApi
      .getHistory()
      .then((data) => setRunHistory(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchRunHistory();
  }, [fetchRunHistory]);

  // WebSocket message dispatcher
  const handleMessage = useCallback((msg) => {
    switch (msg.type) {
      case "instance_info":
        setInstanceInfo({ container: msg.container, n_items: msg.n_items, lower_bound: msg.lower_bound });
        break;

      case "iteration_update":
        setPlacements(msg.solution);
        setBinsUsed(msg.best_bins);
        setChartData((prev) => {
          const next = [...prev, { iter: msg.iteration, bins: msg.best_bins, composite: msg.best_composite }];
          return next.length > 150 ? next.slice(-150) : next;
        });
        setStats({
          iteration: msg.iteration,
          maxIter: msg.max_iter,
          bins: msg.best_bins,
          dissipation: msg.best_dissipation,
          composite: msg.best_composite,
          temperature: msg.temperature,
          lastUdhc: msg.last_udhc,
          udhcAccepted: msg.udhc_accepted,
        });
        break;

      case "instance_complete":
        setPlacements(msg.items);
        setBinsUsed(msg.bins_used);
        setFinalResult(msg);
        setRunning(false);
        // Persist run details
        runsApi.saveRun({
          strategy: strategy,
          instance: isCustomized ? "custom.json" : msg.instance.split(/[\\/]/).pop(),
          n_items: msg.n_items,
          space_util: msg.metrics?.M1_space_utilization_pct || msg.volume_util_pct,
          dissipation: msg.dissipation,
          runtime_s: msg.runtime_s,
          bins_used: msg.bins_used,
          placements: msg.items,
          container: msg.container
        }).then(() => fetchRunHistory()).catch(() => {});
        break;

      case "stopped":
        setRunning(false);
        break;

      case "run_closed":
        if (msg.code !== 0) setError(`Optimizer process exited with code ${msg.code}`);
        setRunning(false);
        break;

      case "error":
        setError(msg.error);
        setRunning(false);
        break;

      default:
        break;
    }
  }, [strategy, isCustomized, fetchRunHistory]);

  const connect = useCallback(() => {
    const ws = new WebSocket("ws://localhost:3002");
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => {
      setWsConnected(false);
      reconnectRef.current = setTimeout(connect, 3000);
    };
    ws.onerror = () => {};
    ws.onmessage = (e) => {
      try {
        handleMessage(JSON.parse(e.data));
      } catch {}
    };
  }, [handleMessage]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Keep WebSocket message callback fresh
  useEffect(() => {
    if (wsRef.current) {
      wsRef.current.onmessage = (e) => {
        try {
          handleMessage(JSON.parse(e.data));
        } catch {}
      };
    }
  }, [handleMessage]);

  // Run timer
  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Run handler
  const handleStartRun = useCallback(async () => {
    if (running || !wsConnected) return;
    setRunning(true);
    setInstanceInfo(null);
    setPlacements(null);
    setBinsUsed(0);
    setChartData([]);
    setStats(null);
    setFinalResult(null);
    setError(null);

    let runPath = selected;

    // Use custom path if user added manual items OR if no OR-Library instance is selected
    if (isCustomized || !selected) {
      try {
        const data = await instancesApi.saveCustom({
          container: containerSpecs,
          items: itemsList
        });
        if (data.path) {
          runPath = data.path;
        } else {
          throw new Error(data.error || "Failed to compile custom configuration");
        }
      } catch (err) {
        setError(err.message);
        setRunning(false);
        return;
      }
    }

    wsRef.current.send(JSON.stringify({ action: "run", instancePath: runPath, maxTime, strategy }));
    setActiveTab("visualization");
  }, [selected, running, wsConnected, maxTime, isCustomized, containerSpecs, itemsList, strategy]);

  const handleStopRun = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ action: "stop" }));
  }, []);

  // Exporters
  const handleExportResultsCSV = () => {
    if (!finalResult || !finalResult.items) return;
    const headers = "Sequence,Item ID,Bin ID,X,Y,Z,Length,Height,Depth\n";
    const rows = finalResult.items.map((item, idx) => 
      `${idx + 1},${item.id},Bin ${item.bin_id},${item.x},${item.y},${item.z},${item.l},${item.h},${item.d}`
    ).join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `STACKR-Packing-Results-${isCustomized ? "custom" : finalResult.instance.split(/[\\/]/).pop().replace('.json', '')}.csv`;
    link.click();
  };

  const handleExportReport = () => {
    window.print();
  };

  const handleExportHistory = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(runHistory, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "STACKR-optimization-history.json");
    downloadAnchor.click();
  };

  const handleLoadVisualization = useCallback((run) => {
    if (!run || !run.placements || !run.container) return;
    setPlacements(run.placements);
    setInstanceInfo({
      container: run.container,
      n_items: run.placements.length,
      lower_bound: 1
    });
    setBinsUsed(run.bins_used || 1);
    setActiveTab("visualization");
  }, []);

  // Group dataset instances
  const groupedInstances = useMemo(() => {
    const g = {};
    for (const inst of instances) {
      if (!g[inst.set]) g[inst.set] = [];
      g[inst.set].push(inst);
    }
    return g;
  }, [instances]);

  const selectedInstanceObj = useMemo(() => {
    return instances.find((i) => i.path === selected);
  }, [instances, selected]);

  const initials = user?.name ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) : "US";

  // Calculate actual X, Y, Z axis utilization dynamically
  const axisUtil = useMemo(() => {
    if (!finalResult || !finalResult.items || !finalResult.container) return { x: 91, y: 84, z: 78 };
    const { L, H, D } = finalResult.container;
    let maxX = 0, maxY = 0, maxZ = 0;
    for (const item of finalResult.items) {
      if (item.x + item.l > maxX) maxX = item.x + item.l;
      if (item.y + item.h > maxY) maxY = item.y + item.h;
      if (item.z + item.d > maxZ) maxZ = item.z + item.d;
    }
    return {
      x: Math.round(Math.min(100, (maxX / L) * 100)),
      y: Math.round(Math.min(100, (maxY / H) * 100)),
      z: Math.round(Math.min(100, (maxZ / D) * 100)),
    };
  }, [finalResult]);

  const canRun = wsConnected && !running && (itemsList.length > 0 || instanceItems.length > 0);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-app)", color: "var(--text-main)" }}>
      
      {/* ── HEADER (STACKR BRANDING) ────────────────────────────────────────── */}
      <header style={{
        background: "var(--bg-card)",
        borderBottom: "1px solid var(--border)",
        padding: "14px 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        boxShadow: "var(--shadow)",
        position: "sticky",
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={logoImg} alt="STACKR Logo" style={{ width: "36px", height: "36px", borderRadius: "8px", objectFit: "contain" }} />
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: "800", color: "var(--text-main)", letterSpacing: "-0.5px", lineHeight: 1.1 }}>STACKR</h1>
            <span style={{ fontSize: "11px", color: "var(--text-dim)", fontWeight: "600" }}>3D Bin Packing Optimizer</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {selectedInstanceObj && (
            <div style={{
              background: "var(--primary-light)",
              border: "1px solid var(--border)",
              borderRadius: "20px",
              padding: "6px 14px",
              fontSize: "12px",
              fontWeight: "700",
              color: "var(--primary)",
              display: "flex",
              alignItems: "center",
              gap: 8
            }}>
              OR-Library Benchmark: {selectedInstanceObj.label}
            </div>
          )}

          {/* Theme Toggle */}
          <button
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            style={{
              background: "var(--bg-input)",
              border: "1px solid var(--border)",
              borderRadius: "50%",
              width: "36px",
              height: "36px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-main)",
              boxShadow: "var(--shadow)",
            }}
            title="Toggle Theme"
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>

          {/* Profile Dropdown */}
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <div
              onClick={() => setProfileOpen((o) => !o)}
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: "var(--primary)",
                color: "#ffffff",
                fontWeight: "800",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "var(--shadow)"
              }}
            >
              {initials}
            </div>
            {profileOpen && (
              <div style={{
                position: "absolute",
                right: 0,
                top: "46px",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: "12px",
                width: "220px",
                boxShadow: "var(--shadow-lg)",
                padding: "16px",
                zIndex: 1000
              }}>
                <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "12px", marginBottom: "12px" }}>
                  <div style={{ fontWeight: "700", fontSize: "14px", color: "var(--text-main)" }}>{user?.name || "User"}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-dim)", textTransform: "capitalize" }}>{user?.role || "Researcher"}</div>
                </div>
                <button
                  onClick={() => {
                    logout();
                    setProfileOpen(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "transparent",
                    border: "1px solid var(--red)",
                    borderRadius: "6px",
                    color: "var(--red)",
                    fontWeight: "600",
                    fontSize: "13px",
                    cursor: "pointer",
                    textAlign: "center"
                  }}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── ERROR DISPLAY ── */}
      {error && (
        <div style={{ margin: "16px 28px 0", background: "var(--red-light)", border: "1px solid var(--red)", borderRadius: "8px", padding: "12px 18px", color: "var(--red)", fontSize: "14px" }}>
          ⚠ {error}
        </div>
      )}

      {/* ── TAB BAR ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: "12px 28px 0", display: "flex", gap: "10px", borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}>
        {[
          { id: "logistics", label: "Logistics" },
          { id: "results", label: "Results" },
          { id: "visualization", label: "Visualization" },
          { id: "history", label: "Run history" }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── MAIN LAYOUT ──────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, padding: "28px" }}>

      {/* ── LOGISTICS TAB ── */}
      {activeTab === "logistics" && (
        <LogisticsTab
          containerSpecs={containerSpecs}
          setContainerSpecs={setContainerSpecs}
          maxLoad={maxLoad}
          setMaxLoad={setMaxLoad}
          strategy={strategy}
          setStrategy={setStrategy}
          wolfSize={wolfSize}
          setWolfSize={setWolfSize}
          maxIter={maxIter}
          setMaxIter={setMaxIter}
          fragilityConstraint={fragilityConstraint}
          setFragilityConstraint={setFragilityConstraint}
          rotationConstraint={rotationConstraint}
          setRotationConstraint={setRotationConstraint}
          lifoConstraint={lifoConstraint}
          setLifoConstraint={setLifoConstraint}
          itemsList={itemsList}
          setItemsList={setItemsList}
          setIsCustomized={setIsCustomized}
          instanceItems={instanceItems}
          loadingList={loadingList}
          selected={selected}
          setSelected={setSelected}
          groupedInstances={groupedInstances}
          running={running}
          elapsed={elapsed}
          handleStartRun={handleStartRun}
          handleStopRun={handleStopRun}
          canRun={canRun}
        />
      )}

      {/* ── RESULTS TAB ── */}
      {activeTab === "results" && (
        <ResultsTab
          finalResult={finalResult}
          runHistory={runHistory}
          strategy={strategy}
          stats={stats}
          axisUtil={axisUtil}
          chartData={chartData}
          maxIter={maxIter}
          handleExportResultsCSV={handleExportResultsCSV}
          handleExportReport={handleExportReport}
        />
      )}

      {/* ── VISUALIZATION TAB ── */}
      {activeTab === "visualization" && (
        <VisualizationTab
          placements={placements}
          itemsList={itemsList}
          instanceInfo={instanceInfo}
          binsUsed={binsUsed}
          running={running}
        />
      )}

      {/* ── RUN HISTORY TAB ── */}
      {activeTab === "history" && (
        <RunHistoryTab
          runHistory={runHistory}
          handleExportHistory={handleExportHistory}
          onLoadVisualization={handleLoadVisualization}
        />
      )}

    </main>
    </div>
  );
}
