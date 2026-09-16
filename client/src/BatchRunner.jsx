/**
 * BatchRunner.jsx
 * Real-time batch optimisation viewer.
 *
 * Connects to ws://localhost:3002 and listens for events from the Python
 * optimizer as it processes every instance in a chosen BR set.
 * The 3-D view updates after every GWO iteration (live "3D Tetris").
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import BinViewer from './BinViewer';
import { batchApi } from './services/api';

// ── Colour helpers ────────────────────────────────────────────────────────────
const UDHC_COLORS = {
  UDHC1: '#60a5fa',
  UDHC2: '#34d399',
  UDHC3: '#f59e0b',
  UDHC4: '#f87171',
  UDHC5: '#a78bfa',
};

const BR_SETS = Array.from({ length: 19 }, (_, i) => `BR${i}`);

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  section: {
    background:   '#1e293b',
    borderRadius: 10,
    padding:      '20px 24px',
    marginBottom: 20,
  },
  label: {
    display:       'block',
    fontSize:      13,
    fontWeight:    600,
    color:         '#94a3b8',
    marginBottom:  8,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  row: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  select: {
    flex:       '0 0 140px',
    padding:    '10px 14px',
    background: '#0f172a',
    border:     '1px solid #334155',
    borderRadius: 6,
    color:      '#f1f5f9',
    fontSize:   14,
  },
  btn: (disabled) => ({
    padding:      '10px 22px',
    background:   disabled ? '#334155' : '#3b82f6',
    color:        disabled ? '#64748b' : '#fff',
    border:       'none',
    borderRadius: 6,
    fontSize:     14,
    fontWeight:   600,
    cursor:       disabled ? 'not-allowed' : 'pointer',
  }),
  stopBtn: {
    padding:      '10px 22px',
    background:   '#7f1d1d',
    color:        '#fca5a5',
    border:       'none',
    borderRadius: 6,
    fontSize:     14,
    fontWeight:   600,
    cursor:       'pointer',
  },
  overlay: {
    display:       'flex',
    flexWrap:      'wrap',
    gap:           10,
    marginBottom:  12,
  },
  chip: (color) => ({
    padding:      '4px 12px',
    background:   '#0f172a',
    borderRadius: 20,
    fontSize:     13,
    color:        color || '#f1f5f9',
    border:       `1px solid ${color || '#334155'}`,
    whiteSpace:   'nowrap',
  }),
  progress: {
    height:       6,
    background:   '#0f172a',
    borderRadius: 3,
    overflow:     'hidden',
    marginBottom: 12,
  },
  progressFill: (pct) => ({
    height:     '100%',
    width:      `${pct}%`,
    background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
    transition: 'width 0.3s ease',
  }),
  log: {
    maxHeight:  120,
    overflowY:  'auto',
    background: '#0f172a',
    borderRadius: 6,
    padding:    '8px 12px',
    fontSize:   12,
    color:      '#64748b',
    fontFamily: 'monospace',
  },
  logEntry: (type) => ({
    color: type === 'error'    ? '#f87171'
         : type === 'complete' ? '#34d399'
         : type === 'batch'    ? '#a78bfa'
         : '#64748b',
    marginBottom: 2,
  }),
  wsDot: (connected) => ({
    display:      'inline-block',
    width:        8,
    height:       8,
    borderRadius: '50%',
    background:   connected ? '#34d399' : '#f87171',
    marginRight:  6,
  }),
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function BatchRunner() {
  const wsRef          = useRef(null);
  const logRef         = useRef(null);

  const [wsConnected,  setWsConnected]  = useState(false);
  const [selectedSet,  setSelectedSet]  = useState('BR0');
  const [running,      setRunning]      = useState(false);

  // Live stats from WebSocket
  const [batchInfo,    setBatchInfo]    = useState(null);   // { set, total }
  const [instInfo,     setInstInfo]     = useState(null);   // { label, index, total }
  const [iterInfo,     setIterInfo]     = useState(null);   // latest iteration_update
  const [container,    setContainer]    = useState(null);   // from instance_info
  const [liveResult,   setLiveResult]   = useState(null);   // for BinViewer
  const [logEntries,   setLogEntries]   = useState([]);
  const [summary,      setSummary]      = useState([]);     // per-instance results

  // ── Log helper ──────────────────────────────────────────────────────────────
  const addLog = useCallback((text, type = 'info') => {
    setLogEntries(prev => {
      const next = [...prev.slice(-199), { text, type, id: Date.now() + Math.random() }];
      return next;
    });
    // Auto-scroll
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, 20);
  }, []);

  // ── WebSocket lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    let ws;
    let reconnectTimer;

    function connect() {
      ws = new WebSocket('ws://localhost:3002');
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        addLog('WebSocket connected to localhost:3002', 'batch');
      };

      ws.onclose = () => {
        setWsConnected(false);
        addLog('WebSocket disconnected — reconnecting in 3s…', 'error');
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        addLog('WebSocket error (is the server running?)', 'error');
      };

      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); }
        catch { return; }
        handleMessage(msg);
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Message handler ─────────────────────────────────────────────────────────
  const handleMessage = useCallback((msg) => {
    switch (msg.type) {

      case 'batch_start':
        setBatchInfo({ set: msg.set, total: msg.total });
        setSummary([]);
        setLiveResult(null);
        addLog(`▶ Batch started: ${msg.set} (${msg.total} instances)`, 'batch');
        break;

      case 'instance_start':
        setInstInfo({ label: msg.label, index: msg.index, total: msg.total });
        setIterInfo(null);
        setContainer(null);
        setLiveResult(null);
        addLog(`  [${msg.index + 1}/${msg.total}] ${msg.label}`);
        break;

      case 'instance_info':
        setContainer(msg.container);
        break;

      case 'iteration_update':
        setIterInfo(msg);
        // Update 3-D view with latest best solution
        if (container) {
          setLiveResult({
            container: container,
            bins_used: msg.best_bins,
            items:     msg.solution,
            n_items:   msg.solution.length,
          });
        }
        break;

      case 'integration_applied':
        addLog(`    Integration: -${msg.bins_reduced_by} bin → ${msg.new_bins} bins`, 'complete');
        break;

      case 'instance_complete':
        setSummary(prev => [...prev, {
          label:    msg.instance,
          bins:     msg.bins_used,
          lb:       msg.lower_bound,
          score:    msg.composite_score,
          su:       msg.metrics ? msg.metrics.M1_space_utilization_pct      : null,
          csr:      msg.metrics ? msg.metrics.M2_constraint_satisfaction_pct : null,
          et:       msg.metrics ? msg.metrics.M3_execution_time_ms          : null,
        }]);
        addLog(
          `  ✔ Done: ${msg.bins_used} bins (LB ${msg.lower_bound})` +
          (msg.metrics ? `  ·  SU ${msg.metrics.M1_space_utilization_pct}%`
                       + `  CSR ${msg.metrics.M2_constraint_satisfaction_pct}%` : ''),
          'complete'
        );
        break;

      case 'instance_error':
        addLog(`  ✗ Error on ${msg.file}: ${msg.error}`, 'error');
        break;

      case 'batch_complete':
        setRunning(false);
        addLog(`✔ Batch ${msg.set} complete — ${msg.total} instances`, 'batch');
        break;

      case 'batch_error':
        setRunning(false);
        addLog(`✗ Batch error: ${msg.error}`, 'error');
        break;

      default:
        break;
    }
  }, [container, addLog]);

  // Keep the message handler up to date when container changes
  useEffect(() => {
    if (!wsRef.current) return;
    wsRef.current.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); }
      catch { return; }
      handleMessage(msg);
    };
  }, [handleMessage]);

  // ── Start batch ─────────────────────────────────────────────────────────────
  const startBatch = useCallback(async () => {
    if (running || !wsConnected) return;
    setRunning(true);
    setLogEntries([]);
    setSummary([]);
    addLog(`Requesting batch: ${selectedSet}`, 'batch');
  
    try {
      const data = await batchApi.runBatch(selectedSet);
      if (data && data.error) {
        addLog(`Server error: ${data.error}`, 'error');
        setRunning(false);
      }
    } catch (err) {
      addLog(`Request failed: ${err.message}`, 'error');
      setRunning(false);
    }
  }, [running, wsConnected, selectedSet, addLog]);

  // ── Computed values ──────────────────────────────────────────────────────────
  const batchPct  = instInfo ? Math.round(((instInfo.index + 1) / instInfo.total) * 100) : 0;
  const iterPct   = iterInfo ? Math.round((iterInfo.iteration / iterInfo.max_iter)  * 100) : 0;
  const udhcColor = iterInfo ? (UDHC_COLORS[iterInfo.last_udhc] || '#94a3b8') : '#94a3b8';

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Controls ── */}
      <div style={S.section}>
        <label style={S.label}>
          <span style={S.wsDot(wsConnected)} />
          Batch Mode — WebSocket {wsConnected ? 'Connected' : 'Disconnected'}
        </label>

        <div style={S.row}>
          <select
            style={S.select}
            value={selectedSet}
            onChange={e => setSelectedSet(e.target.value)}
            disabled={running}
          >
            {BR_SETS.map(s => <option key={s}>{s}</option>)}
          </select>

          <button
            style={S.btn(running || !wsConnected)}
            onClick={startBatch}
            disabled={running || !wsConnected}
          >
            {running ? `Running… (${batchInfo?.set || selectedSet})` : '▶  Run Batch'}
          </button>

          {running && (
            <span style={{ color: '#94a3b8', fontSize: 13 }}>
              Reload the page or restart the server to cancel.
            </span>
          )}
        </div>
      </div>

      {/* ── Live stats overlay ── */}
      {(running || iterInfo) && (
        <div style={S.section}>
          <label style={S.label}>Live Status</label>

          {/* Batch progress */}
          {instInfo && (
            <>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
                Batch: {instInfo.index + 1} / {instInfo.total} — {instInfo.label}
              </div>
              <div style={S.progress}>
                <div style={S.progressFill(batchPct)} />
              </div>
            </>
          )}

          {/* Iteration progress */}
          {iterInfo && (
            <>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
                Iteration: {iterInfo.iteration} / {iterInfo.max_iter}
              </div>
              <div style={S.progress}>
                <div style={S.progressFill(iterPct)} />
              </div>
            </>
          )}

          {/* Stat chips */}
          {iterInfo && (
            <div style={S.overlay}>
              <span style={S.chip('#60a5fa')}>
                Bins: {iterInfo.best_bins}
              </span>
              <span style={S.chip('#f59e0b')}>
                Dissipation: {iterInfo.best_dissipation}
              </span>
              <span style={S.chip('#94a3b8')}>
                Temp: {iterInfo.temperature}
              </span>
              <span style={S.chip(udhcColor)}>
                {iterInfo.last_udhc} {iterInfo.udhc_accepted ? '✓' : '✗'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Live 3-D view ── */}
      {liveResult && container && (
        <div style={S.section}>
          <label style={S.label}>Live 3-D View</label>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            Drag to rotate · Scroll to zoom · Updates every iteration
          </p>
          <BinViewer result={liveResult} running={running} />
        </div>
      )}

      {/* ── Activity log ── */}
      <div style={S.section}>
        <label style={S.label}>Activity Log</label>
        <div style={S.log} ref={logRef}>
          {logEntries.length === 0
            ? <span>No activity yet. Press "Run Batch" to start.</span>
            : logEntries.map(e => (
                <div key={e.id} style={S.logEntry(e.type)}>{e.text}</div>
              ))
          }
        </div>
      </div>

      {/* ── Summary table ── */}
      {summary.length > 0 && (
        <div style={S.section}>
          <label style={S.label}>Completed Instances — {summary.length} done</label>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#64748b', textAlign: 'left' }}>
                  <th style={{ padding: '6px 12px' }}>#</th>
                  <th style={{ padding: '6px 12px' }}>Instance</th>
                  <th style={{ padding: '6px 12px' }}>Bins</th>
                  <th style={{ padding: '6px 12px' }}>LB</th>
                  <th style={{ padding: '6px 12px' }}>Score</th>
                  <th style={{ padding: '6px 12px' }}>M-1 SU</th>
                  <th style={{ padding: '6px 12px' }}>M-2 CSR</th>
                  <th style={{ padding: '6px 12px' }}>M-3 ET</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row, i) => (
                  <tr key={i} style={{
                    background:   i % 2 === 0 ? 'transparent' : '#0f172a',
                    color:        row.bins === row.lb ? '#34d399' : '#f1f5f9',
                  }}>
                    <td style={{ padding: '5px 12px' }}>{i + 1}</td>
                    <td style={{ padding: '5px 12px', fontFamily: 'monospace' }}>
                      {row.label.split(/[\\/]/).slice(-1)[0]}
                    </td>
                    <td style={{ padding: '5px 12px', fontWeight: 700 }}>{row.bins}</td>
                    <td style={{ padding: '5px 12px', color: '#64748b' }}>{row.lb}</td>
                    <td style={{ padding: '5px 12px' }}>{row.score.toFixed(3)}</td>
                    <td style={{ padding: '5px 12px' }}>
                      {row.su == null ? '—' : `${row.su}%`}
                    </td>
                    <td style={{ padding: '5px 12px',
                                 color: row.csr == null ? '#64748b'
                                       : row.csr >= 100 ? '#34d399' : '#f59e0b' }}>
                      {row.csr == null ? '—' : `${row.csr}%`}
                    </td>
                    <td style={{ padding: '5px 12px', color: '#64748b' }}>
                      {row.et == null ? '—' : `${Math.round(row.et)} ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}