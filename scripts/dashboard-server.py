#!/usr/bin/env python3
"""
CacheLane Live Dashboard Server
Usage: python3 scripts/dashboard-server.py [--port 7331] [--db path]
Opens a browser with a live-updating chart dashboard that polls the SQLite DB.
"""
from __future__ import annotations
import argparse
import json
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

DB_PATH = Path.home() / ".cachelane" / "cachelane.db"

# ── Data layer ────────────────────────────────────────────────────────────────

def query_db(sql: str, params: tuple = ()) -> list[dict]:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    rows = con.execute(sql, params).fetchall()
    con.close()
    return [dict(r) for r in rows]


def get_sessions() -> list[dict]:
    return query_db("""
        SELECT session_id,
               COUNT(*) AS turns,
               ROUND(SUM(cache_read_tokens) * 100.0 /
                 NULLIF(SUM(input_tokens + cache_creation_5m_tokens +
                            cache_creation_1h_tokens + cache_read_tokens), 0), 1) AS hit_pct,
               ROUND((1.0 - SUM(effective_cost_units) /
                 NULLIF(SUM(input_tokens + cache_creation_5m_tokens +
                            cache_creation_1h_tokens + cache_read_tokens), 0)) * 100, 1) AS savings_pct,
               MAX(created_at) AS last_active_ms
        FROM turns
        GROUP BY session_id
        ORDER BY last_active_ms DESC
    """)


def get_turns(session_id: str) -> list[dict]:
    return query_db("""
        SELECT turn_number,
               input_tokens,
               cache_creation_5m_tokens + cache_creation_1h_tokens AS cache_write_tokens,
               cache_read_tokens,
               effective_cost_units,
               input_tokens + cache_creation_5m_tokens + cache_creation_1h_tokens
                 + cache_read_tokens AS baseline_cost_units
        FROM turns
        WHERE session_id = ?
        ORDER BY turn_number ASC
    """, (session_id,))


def api_data(session_id: str | None) -> dict:
    sessions = get_sessions()
    if not sessions:
        return {"sessions": [], "turns": [], "session_id": None}

    sid = session_id or sessions[0]["session_id"]
    turns = get_turns(sid)

    # Cumulative cost series
    cum_baseline, cum_effective = 0.0, 0.0
    for t in turns:
        cum_baseline  += t["baseline_cost_units"]
        cum_effective += t["effective_cost_units"]
        t["cum_baseline"]  = round(cum_baseline)
        t["cum_effective"] = round(cum_effective)
        total = t["baseline_cost_units"]
        t["hit_pct"] = round(t["cache_read_tokens"] / total * 100, 1) if total else 0

    return {"sessions": sessions, "turns": turns, "session_id": sid}


# ── HTTP handler ──────────────────────────────────────────────────────────────

HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>CacheLane Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg: #0f172a; --panel: #1e293b; --border: #334155;
    --blue: #3b82f6; --red: #ef4444; --green: #22c55e;
    --amber: #f59e0b; --text: #f1f5f9; --muted: #94a3b8;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; padding: 20px; }
  h1 { font-size: 1.4rem; margin-bottom: 4px; }
  .subtitle { color: var(--muted); font-size: .85rem; margin-bottom: 20px; }

  .sessions { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 24px; }
  .session-btn {
    background: var(--panel); border: 1px solid var(--border); color: var(--text);
    padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: .82rem;
    transition: border-color .15s;
  }
  .session-btn:hover { border-color: var(--blue); }
  .session-btn.active { border-color: var(--blue); background: #1d3a5f; }
  .session-btn .sid  { font-family: monospace; font-size: .78rem; color: var(--muted); }
  .session-btn .meta { margin-top: 2px; font-size: .8rem; }
  .session-btn .hit  { color: var(--green); font-weight: 600; }
  .session-btn .save { color: var(--amber); font-weight: 600; }

  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px 20px; }
  .stat .val { font-size: 2rem; font-weight: 700; }
  .stat .lbl { color: var(--muted); font-size: .8rem; margin-top: 4px; }
  .stat.blue .val  { color: var(--blue); }
  .stat.green .val { color: var(--green); }
  .stat.amber .val { color: var(--amber); }
  .stat.red .val   { color: var(--red); }

  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .chart-full { grid-column: 1 / -1; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  .card h2 { font-size: .9rem; color: var(--muted); margin-bottom: 12px; font-weight: 500; }
  canvas { width: 100% !important; }

  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .82rem; }
  th { color: var(--muted); text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--border); font-weight: 500; }
  th:first-child { text-align: left; }
  td { text-align: right; padding: 6px 10px; border-bottom: 1px solid #1a2740; }
  td:first-child { text-align: left; font-family: monospace; }
  tr:hover td { background: #1a2740; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 99px; font-size: .75rem; font-weight: 600; }
  .pill.green { background: #14532d; color: #4ade80; }
  .pill.amber { background: #451a03; color: #fbbf24; }

  .pulse { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
           background: var(--green); margin-right: 6px;
           animation: pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.7)} }
</style>
</head>
<body>

<h1>CacheLane Live Dashboard</h1>
<p class="subtitle"><span class="pulse"></span>Auto-refreshes every 3 seconds from local SQLite DB</p>

<div class="sessions" id="sessions"></div>

<div class="stats">
  <div class="stat blue">  <div class="val" id="s-turns">—</div>  <div class="lbl">Turns Recorded</div></div>
  <div class="stat green"> <div class="val" id="s-hit">—</div>    <div class="lbl">Avg Cache Hit Ratio</div></div>
  <div class="stat amber"> <div class="val" id="s-savings">—</div><div class="lbl">Total Savings</div></div>
  <div class="stat red">   <div class="val" id="s-cost">—</div>   <div class="lbl">Effective Cost Units</div></div>
</div>

<div class="charts">
  <div class="card chart-full">
    <h2>Cumulative Cost — With CacheLane vs Without Cache</h2>
    <canvas id="c-cumulative" height="90"></canvas>
  </div>
  <div class="card">
    <h2>Cache Hit Ratio Per Turn</h2>
    <canvas id="c-hitratio" height="160"></canvas>
  </div>
  <div class="card">
    <h2>Token Composition Per Turn</h2>
    <canvas id="c-tokens" height="160"></canvas>
  </div>
</div>

<div class="card">
  <h2>Recent Turns</h2>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Turn</th>
        <th>Fresh Input</th>
        <th>Cache Write</th>
        <th>Cache Read</th>
        <th>Hit %</th>
        <th>Effective Cost</th>
        <th>Baseline Cost</th>
      </tr></thead>
      <tbody id="t-turns"></tbody>
    </table>
  </div>
</div>

<script>
const COLORS = {
  blue:'#3b82f6', red:'#ef4444', green:'#22c55e',
  amber:'#f59e0b', grey:'#6b7280', bg:'#1e293b', border:'#334155', text:'#f1f5f9'
};

const chartDefaults = {
  responsive: true,
  animation: false,
  plugins: { legend: { labels: { color: COLORS.text, boxWidth: 12, font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: '#64748b', font:{size:10} }, grid: { color: COLORS.border } },
    y: { ticks: { color: '#64748b', font:{size:10} }, grid: { color: COLORS.border } },
  }
};

function makeChart(id, type, data, options={}) {
  const ctx = document.getElementById(id).getContext('2d');
  return new Chart(ctx, { type, data, options: { ...chartDefaults, ...options } });
}

function fmt(n) {
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toFixed(0);
}

let charts = {};
let currentSession = null;

function initCharts(turns) {
  const labels = turns.map(t => t.turn_number);

  if (charts.cumulative) { charts.cumulative.destroy(); charts.cumulative = null; }
  if (charts.hitratio)   { charts.hitratio.destroy();   charts.hitratio   = null; }
  if (charts.tokens)     { charts.tokens.destroy();     charts.tokens     = null; }

  charts.cumulative = makeChart('c-cumulative', 'line', {
    labels,
    datasets: [
      { label:'Without Cache (baseline)', data: turns.map(t=>t.cum_baseline),
        borderColor:COLORS.red,  backgroundColor:'rgba(239,68,68,0.06)',
        fill:true, tension:.3, pointRadius:0, borderWidth:2 },
      { label:'With CacheLane', data: turns.map(t=>t.cum_effective),
        borderColor:COLORS.blue, backgroundColor:'rgba(59,130,246,0.08)',
        fill:true, tension:.3, pointRadius:0, borderWidth:2 },
    ]
  }, { plugins:{...chartDefaults.plugins,
    tooltip:{callbacks:{label: ctx => `${ctx.dataset.label}: ${fmt(ctx.raw)}`}}} });

  charts.hitratio = makeChart('c-hitratio', 'line', {
    labels,
    datasets: [{ label:'Cache Hit %', data: turns.map(t=>t.hit_pct),
      borderColor:COLORS.green, backgroundColor:'rgba(34,197,94,0.1)',
      fill:true, tension:.2, pointRadius:2, pointBackgroundColor:COLORS.green, borderWidth:1.5 }]
  }, { scales:{...chartDefaults.scales, y:{...chartDefaults.scales.y,
    min:0, max:105, ticks:{callback:v=>v+'%', color:'#64748b', font:{size:10}},
    grid:{color:COLORS.border}}} });

  charts.tokens = makeChart('c-tokens', 'bar', {
    labels,
    datasets: [
      { label:'Cache Read (0.1×)',  data:turns.map(t=>t.cache_read_tokens),
        backgroundColor:'rgba(59,130,246,0.75)',  stack:'s' },
      { label:'Cache Write (1.25×)',data:turns.map(t=>t.cache_write_tokens),
        backgroundColor:'rgba(245,158,11,0.85)',  stack:'s' },
      { label:'Fresh Input (1×)',   data:turns.map(t=>t.input_tokens),
        backgroundColor:'rgba(107,114,128,0.85)', stack:'s' },
    ]
  }, { plugins:{...chartDefaults.plugins,
    tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${fmt(ctx.raw)}`}}},
    scales:{...chartDefaults.scales, x:{display:false},
      y:{...chartDefaults.scales.y, stacked:true,
        ticks:{callback:v=>fmt(v), color:'#64748b', font:{size:10}}, grid:{color:COLORS.border}}} });
}

function updateCharts(turns) {
  const labels = turns.map(t => t.turn_number);
  ['cumulative','hitratio','tokens'].forEach(k => {
    if (!charts[k]) return;
    charts[k].data.labels = labels;
  });
  charts.cumulative.data.datasets[0].data = turns.map(t => t.cum_baseline);
  charts.cumulative.data.datasets[1].data = turns.map(t => t.cum_effective);
  charts.hitratio.data.datasets[0].data   = turns.map(t => t.hit_pct);
  charts.tokens.data.datasets[0].data     = turns.map(t => t.cache_read_tokens);
  charts.tokens.data.datasets[1].data     = turns.map(t => t.cache_write_tokens);
  charts.tokens.data.datasets[2].data     = turns.map(t => t.input_tokens);
  Object.values(charts).forEach(c => c.update('none'));
}

function renderSessions(sessions, activeId) {
  const el = document.getElementById('sessions');
  el.innerHTML = sessions.map(s => `
    <button class="session-btn ${s.session_id===activeId?'active':''}"
            onclick="selectSession('${s.session_id}')">
      <div class="sid">${s.session_id.slice(0,8)}…</div>
      <div class="meta">
        <b>${s.turns}</b> turns &nbsp;
        <span class="hit">${s.hit_pct??0}% hit</span> &nbsp;
        <span class="save">${s.savings_pct??0}% saved</span>
      </div>
    </button>`).join('');
}

function renderStats(turns) {
  if (!turns.length) return;
  const last = turns[turns.length-1];
  const avgHit = (turns.reduce((a,t)=>a+t.hit_pct,0)/turns.length).toFixed(1);
  const totalBase = last.cum_baseline, totalEff = last.cum_effective;
  const saved = ((totalBase-totalEff)/totalBase*100).toFixed(1);
  document.getElementById('s-turns').textContent   = turns.length;
  document.getElementById('s-hit').textContent     = avgHit + '%';
  document.getElementById('s-savings').textContent = saved + '%';
  document.getElementById('s-cost').textContent    = fmt(totalEff);
}

function renderTable(turns) {
  const recent = turns.slice(-20).reverse();
  document.getElementById('t-turns').innerHTML = recent.map(t => {
    const hitClass = t.hit_pct >= 80 ? 'green' : 'amber';
    return `<tr>
      <td>${t.turn_number}</td>
      <td>${fmt(t.input_tokens)}</td>
      <td>${fmt(t.cache_write_tokens)}</td>
      <td>${fmt(t.cache_read_tokens)}</td>
      <td><span class="pill ${hitClass}">${t.hit_pct}%</span></td>
      <td>${fmt(t.effective_cost_units)}</td>
      <td>${fmt(t.baseline_cost_units)}</td>
    </tr>`;
  }).join('');
}

let chartsInitialized = false;

async function refresh() {
  try {
    const url = currentSession ? `/api/data?session=${currentSession}` : '/api/data';
    const res  = await fetch(url);
    const data = await res.json();
    if (!data.sessions.length) return;

    currentSession = data.session_id;
    renderSessions(data.sessions, currentSession);
    renderStats(data.turns);
    renderTable(data.turns);

    if (!chartsInitialized) {
      initCharts(data.turns);
      chartsInitialized = true;
    } else {
      updateCharts(data.turns);
    }
  } catch(e) { console.warn('refresh error', e); }
}

function selectSession(sid) {
  currentSession = sid;
  chartsInitialized = false;
  refresh();
}

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>
"""

# ── HTTP server ───────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass  # silence access logs

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/data":
            qs = parse_qs(parsed.query)
            sid = qs.get("session", [None])[0]
            try:
                payload = json.dumps(api_data(sid)).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(payload)
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())

        elif parsed.path in ("/", "/index.html"):
            body = HTML.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)

        else:
            self.send_response(404)
            self.end_headers()


def main():
    parser = argparse.ArgumentParser(description="CacheLane live dashboard server")
    parser.add_argument("--port", type=int, default=7331)
    parser.add_argument("--db",   help="Path to cachelane.db")
    args = parser.parse_args()

    global DB_PATH
    if args.db:
        DB_PATH = Path(args.db)
    if not DB_PATH.exists():
        sys.exit(f"Database not found: {DB_PATH}\nRun: cachelane install")

    url = f"http://localhost:{args.port}"
    print(f"\nCacheLane Dashboard running at {url}")
    print(f"DB: {DB_PATH}")
    print("Ctrl+C to stop\n")

    try:
        HTTPServer(("", args.port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
