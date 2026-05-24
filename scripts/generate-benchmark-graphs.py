#!/usr/bin/env python3
"""
CacheLane Benchmark Graph Generator
Reads from ~/.cachelane/cachelane.db and writes charts to docs/benchmarks/graphs/.
Usage: python3 scripts/generate-benchmark-graphs.py [--session <uuid>]
"""
from __future__ import annotations
import sqlite3
import sys
import argparse
from pathlib import Path
from datetime import datetime

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.gridspec as gridspec
from matplotlib.ticker import FuncFormatter
import seaborn as sns

# ── Config ────────────────────────────────────────────────────────────────────
DB_PATH   = Path.home() / ".cachelane" / "cachelane.db"
OUT_DIR   = Path(__file__).parent.parent / "docs" / "benchmarks" / "graphs"
DPI       = 180

# Palette
C_BASELINE = "#E05252"   # red   — no-cache cost
C_CACHED   = "#3B82F6"   # blue  — with-cache cost
C_SAVINGS  = "#22C55E"   # green — savings fill
C_CACHE_R  = "#60A5FA"   # light blue — cache-read tokens
C_CACHE_W  = "#F59E0B"   # amber      — cache-creation tokens
C_INPUT    = "#6B7280"   # grey        — fresh input tokens
BG         = "#0F172A"   # dark slate background
FG         = "#F1F5F9"   # off-white text
GRID       = "#1E293B"   # subtle grid lines

sns.set_theme(style="dark")

# ── Data loading ──────────────────────────────────────────────────────────────
def load_turns(session_id: str) -> list[dict]:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """
        SELECT turn_number,
               input_tokens,
               cache_creation_5m_tokens,
               cache_creation_1h_tokens,
               cache_read_tokens,
               effective_cost_units,
               created_at
        FROM   turns
        WHERE  session_id = ?
        ORDER  BY turn_number ASC
        """,
        (session_id,),
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def pick_session(session_id: str | None) -> str:
    con = sqlite3.connect(DB_PATH)
    if session_id:
        row = con.execute(
            "SELECT session_id FROM turns WHERE session_id = ? LIMIT 1", (session_id,)
        ).fetchone()
        con.close()
        if not row:
            sys.exit(f"Session not found: {session_id}")
        return session_id
    row = con.execute(
        "SELECT session_id, COUNT(*) AS n FROM turns GROUP BY session_id ORDER BY n DESC LIMIT 1"
    ).fetchone()
    con.close()
    if not row:
        sys.exit("No turns in database. Run a Claude Code session first.")
    return row[0]


# ── Derived metrics ───────────────────────────────────────────────────────────
def derive(turns: list[dict]) -> dict:
    n = len(turns)
    turn_nums        = np.array([t["turn_number"] for t in turns])
    input_tok        = np.array([t["input_tokens"] for t in turns], dtype=float)
    cache_create_5m  = np.array([t["cache_creation_5m_tokens"] for t in turns], dtype=float)
    cache_create_1h  = np.array([t["cache_creation_1h_tokens"] for t in turns], dtype=float)
    cache_read       = np.array([t["cache_read_tokens"] for t in turns], dtype=float)
    effective        = np.array([t["effective_cost_units"] for t in turns], dtype=float)

    cache_create = cache_create_5m + cache_create_1h
    total_ctx    = input_tok + cache_create + cache_read       # total tokens in context per turn
    baseline     = total_ctx                                   # cost if nothing were cached (1× each)

    hit_ratio    = np.where(total_ctx > 0, cache_read / total_ctx, 0.0)

    cum_baseline  = np.cumsum(baseline)
    cum_effective = np.cumsum(effective)

    return dict(
        n=n,
        turn_nums=turn_nums,
        input_tok=input_tok,
        cache_create=cache_create,
        cache_read=cache_read,
        effective=effective,
        baseline=baseline,
        hit_ratio=hit_ratio,
        cum_baseline=cum_baseline,
        cum_effective=cum_effective,
        total_baseline=cum_baseline[-1],
        total_effective=cum_effective[-1],
        total_savings=cum_baseline[-1] - cum_effective[-1],
        savings_pct=(cum_baseline[-1] - cum_effective[-1]) / cum_baseline[-1] * 100,
        avg_hit_ratio=float(np.mean(hit_ratio) * 100),
    )


# ── Shared style helpers ──────────────────────────────────────────────────────
def dark_fig(w: float, h: float):
    fig = plt.figure(figsize=(w, h), facecolor=BG)
    return fig


def style_ax(ax):
    ax.set_facecolor(BG)
    ax.tick_params(colors=FG, labelsize=9)
    ax.xaxis.label.set_color(FG)
    ax.yaxis.label.set_color(FG)
    ax.title.set_color(FG)
    for spine in ax.spines.values():
        spine.set_edgecolor(GRID)
    ax.grid(color=GRID, linewidth=0.6, linestyle="--", alpha=0.7)
    return ax


def kfmt(x, _):
    if abs(x) >= 1_000_000:
        return f"{x/1_000_000:.1f}M"
    if abs(x) >= 1_000:
        return f"{x/1_000:.0f}K"
    return f"{x:.0f}"


# ── Chart 1: Cumulative cost — hero shot ──────────────────────────────────────
def chart_cumulative_cost(d: dict, out: Path):
    fig = dark_fig(12, 6)
    ax  = fig.add_subplot(111)
    style_ax(ax)

    turns = d["turn_nums"]
    ax.plot(turns, d["cum_baseline"],  color=C_BASELINE, linewidth=2.2,
            label="Without cache", zorder=3)
    ax.plot(turns, d["cum_effective"], color=C_CACHED,   linewidth=2.2,
            label="With CacheLane", zorder=3)
    ax.fill_between(turns, d["cum_effective"], d["cum_baseline"],
                    color=C_SAVINGS, alpha=0.18, label="Savings area")

    # Annotate final savings
    x_end, y_base, y_eff = turns[-1], d["cum_baseline"][-1], d["cum_effective"][-1]
    ax.annotate(
        f"  {d['savings_pct']:.1f}% saved\n  ({d['total_savings']/1e6:.2f}M units)",
        xy=(x_end, (y_base + y_eff) / 2),
        color=C_SAVINGS, fontsize=11, fontweight="bold", va="center",
    )

    ax.yaxis.set_major_formatter(FuncFormatter(kfmt))
    ax.set_xlabel("Turn Number", fontsize=11)
    ax.set_ylabel("Cumulative Cost Units", fontsize=11)
    ax.set_title("Cumulative Token Cost: CacheLane vs No Cache", fontsize=14, pad=14)
    ax.legend(facecolor="#1E293B", edgecolor=GRID, labelcolor=FG, fontsize=10)
    fig.tight_layout()
    fig.savefig(out, dpi=DPI, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    print(f"  ✓ {out.name}")


# ── Chart 2: Cache hit ratio over turns ──────────────────────────────────────
def chart_hit_ratio(d: dict, out: Path):
    fig = dark_fig(12, 5)
    ax  = fig.add_subplot(111)
    style_ax(ax)

    turns    = d["turn_nums"]
    hit_pct  = d["hit_ratio"] * 100
    window   = min(15, len(turns) // 5 or 1)
    rolling  = np.convolve(hit_pct, np.ones(window) / window, mode="valid")
    roll_x   = turns[window - 1:]

    ax.scatter(turns, hit_pct, color=C_CACHED, s=18, alpha=0.45, zorder=2)
    ax.plot(roll_x, rolling, color=C_SAVINGS, linewidth=2.2,
            label=f"{window}-turn rolling avg", zorder=3)
    ax.axhline(d["avg_hit_ratio"], color=C_BASELINE, linewidth=1.4,
               linestyle="--", label=f"Session avg {d['avg_hit_ratio']:.1f}%", zorder=3)

    ax.set_ylim(0, 105)
    ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f"{x:.0f}%"))
    ax.set_xlabel("Turn Number", fontsize=11)
    ax.set_ylabel("Cache Hit Ratio", fontsize=11)
    ax.set_title("Cache Hit Ratio Per Turn", fontsize=14, pad=14)
    ax.legend(facecolor="#1E293B", edgecolor=GRID, labelcolor=FG, fontsize=10)
    fig.tight_layout()
    fig.savefig(out, dpi=DPI, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    print(f"  ✓ {out.name}")


# ── Chart 3: Token composition stacked area ───────────────────────────────────
def chart_token_composition(d: dict, out: Path):
    fig = dark_fig(12, 5)
    ax  = fig.add_subplot(111)
    style_ax(ax)

    turns = d["turn_nums"]
    ax.stackplot(
        turns,
        d["input_tok"] / 1000,
        d["cache_create"] / 1000,
        d["cache_read"] / 1000,
        labels=["Fresh input (1×)", "Cache write (1.25×)", "Cache read (0.1×)"],
        colors=[C_INPUT, C_CACHE_W, C_CACHE_R],
        alpha=0.85,
    )

    ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f"{x:.0f}K"))
    ax.set_xlabel("Turn Number", fontsize=11)
    ax.set_ylabel("Tokens (thousands)", fontsize=11)
    ax.set_title("Token Composition Per Turn  ·  Cost Multiplier by Region", fontsize=14, pad=14)
    ax.legend(loc="upper left", facecolor="#1E293B", edgecolor=GRID,
              labelcolor=FG, fontsize=10)
    fig.tight_layout()
    fig.savefig(out, dpi=DPI, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    print(f"  ✓ {out.name}")


# ── Chart 4: Per-turn cost — with vs without ──────────────────────────────────
def chart_per_turn_cost(d: dict, out: Path):
    fig = dark_fig(12, 5)
    ax  = fig.add_subplot(111)
    style_ax(ax)

    turns = d["turn_nums"]
    window = min(10, len(turns) // 8 or 1)

    def roll(arr):
        return np.convolve(arr, np.ones(window) / window, mode="valid")

    rx = turns[window - 1:]
    ax.plot(turns, d["baseline"],  color=C_BASELINE, linewidth=1.0, alpha=0.35)
    ax.plot(turns, d["effective"], color=C_CACHED,   linewidth=1.0, alpha=0.35)
    ax.plot(rx, roll(d["baseline"]),  color=C_BASELINE, linewidth=2.2,
            label=f"No cache ({window}-turn avg)")
    ax.plot(rx, roll(d["effective"]), color=C_CACHED,   linewidth=2.2,
            label=f"CacheLane ({window}-turn avg)")

    ax.yaxis.set_major_formatter(FuncFormatter(kfmt))
    ax.set_xlabel("Turn Number", fontsize=11)
    ax.set_ylabel("Cost Units", fontsize=11)
    ax.set_title("Per-Turn Cost: CacheLane vs No Cache", fontsize=14, pad=14)
    ax.legend(facecolor="#1E293B", edgecolor=GRID, labelcolor=FG, fontsize=10)
    fig.tight_layout()
    fig.savefig(out, dpi=DPI, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    print(f"  ✓ {out.name}")


# ── Chart 5: Summary dashboard ────────────────────────────────────────────────
def chart_summary(d: dict, session_id: str, out: Path):
    fig = dark_fig(14, 7)
    gs  = gridspec.GridSpec(2, 3, figure=fig, wspace=0.35, hspace=0.45)

    # ── Big-number cards (top row) ────────────────────────────────────────────
    cards = [
        ("Turns Recorded",     f"{d['n']}",                    C_CACHED),
        ("Avg Cache Hit",      f"{d['avg_hit_ratio']:.1f}%",   C_CACHE_R),
        ("Total Savings",      f"{d['savings_pct']:.1f}%",     C_SAVINGS),
    ]
    for col, (label, value, color) in enumerate(cards):
        ax = fig.add_subplot(gs[0, col])
        ax.set_facecolor(GRID)
        for spine in ax.spines.values():
            spine.set_edgecolor(color)
            spine.set_linewidth(2)
        ax.set_xticks([]); ax.set_yticks([])
        ax.text(0.5, 0.62, value,  ha="center", va="center", fontsize=32,
                fontweight="bold", color=color, transform=ax.transAxes)
        ax.text(0.5, 0.22, label,  ha="center", va="center", fontsize=11,
                color=FG, transform=ax.transAxes)

    # ── Total cost comparison bar (bottom-left) ───────────────────────────────
    ax2 = fig.add_subplot(gs[1, 0:2])
    style_ax(ax2)
    categories = ["Without Cache\n(baseline)", "With CacheLane"]
    values     = [d["total_baseline"], d["total_effective"]]
    colors     = [C_BASELINE, C_CACHED]
    bars = ax2.bar(categories, [v / 1e6 for v in values], color=colors,
                   width=0.45, zorder=3, edgecolor=GRID)
    for bar, val in zip(bars, values):
        ax2.text(bar.get_x() + bar.get_width() / 2,
                 bar.get_height() + 0.05,
                 f"{val/1e6:.2f}M", ha="center", color=FG, fontsize=10)
    ax2.set_ylabel("Total Cost Units (millions)", fontsize=10)
    ax2.set_title("Total Session Cost Comparison", fontsize=12, pad=10)
    ax2.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f"{x:.1f}M"))

    # ── Donut: cache breakdown (bottom-right) ────────────────────────────────
    ax3 = fig.add_subplot(gs[1, 2])
    ax3.set_facecolor(BG)
    total_tokens = (d["input_tok"].sum() + d["cache_create"].sum() + d["cache_read"].sum())
    fracs = [
        d["input_tok"].sum()    / total_tokens * 100,
        d["cache_create"].sum() / total_tokens * 100,
        d["cache_read"].sum()   / total_tokens * 100,
    ]
    labels = [
        f"Fresh\n{fracs[0]:.1f}%",
        f"Cache write\n{fracs[1]:.1f}%",
        f"Cache read\n{fracs[2]:.1f}%",
    ]
    wedge_colors = [C_INPUT, C_CACHE_W, C_CACHE_R]
    wedges, _ = ax3.pie(
        fracs, colors=wedge_colors, startangle=90,
        wedgeprops=dict(width=0.55, edgecolor=BG, linewidth=1.5),
    )
    for wedge, label in zip(wedges, labels):
        angle  = (wedge.theta2 + wedge.theta1) / 2
        x      = 1.22 * np.cos(np.radians(angle))
        y      = 1.22 * np.sin(np.radians(angle))
        ax3.text(x, y, label, ha="center", va="center", fontsize=8.5, color=FG)
    ax3.set_title("Token Composition\n(all turns)", fontsize=11, color=FG, pad=8)

    # ── Figure title ──────────────────────────────────────────────────────────
    fig.suptitle(
        f"CacheLane Session Benchmark  ·  {d['n']} turns  ·  {session_id[:8]}…",
        color=FG, fontsize=13, y=0.98,
    )
    fig.savefig(out, dpi=DPI, bbox_inches="tight", facecolor=BG)
    plt.close(fig)
    print(f"  ✓ {out.name}")


# ── Entry point ───────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Generate CacheLane benchmark graphs")
    parser.add_argument("--session", help="Session UUID (default: session with most turns)")
    parser.add_argument("--db",      help="Path to cachelane.db")
    args = parser.parse_args()

    global DB_PATH
    if args.db:
        DB_PATH = Path(args.db)
    if not DB_PATH.exists():
        sys.exit(f"Database not found: {DB_PATH}\nRun: cachelane install")

    session_id = pick_session(args.session)
    turns = load_turns(session_id)
    if not turns:
        sys.exit(f"No turns found for session {session_id}")

    d = derive(turns)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\nGenerating benchmark graphs for session {session_id[:8]}… ({d['n']} turns)")
    print(f"Output: {OUT_DIR}\n")

    chart_cumulative_cost(   d, OUT_DIR / "01-cumulative-cost.png")
    chart_hit_ratio(         d, OUT_DIR / "02-cache-hit-ratio.png")
    chart_token_composition( d, OUT_DIR / "03-token-composition.png")
    chart_per_turn_cost(     d, OUT_DIR / "04-per-turn-cost.png")
    chart_summary(           d, session_id, OUT_DIR / "05-summary-dashboard.png")

    print(f"\n✅  5 charts saved to {OUT_DIR}")
    print(f"   Session:  {session_id}")
    print(f"   Turns:    {d['n']}")
    print(f"   Avg hit:  {d['avg_hit_ratio']:.1f}%")
    print(f"   Savings:  {d['savings_pct']:.1f}%  ({d['total_savings']/1e6:.2f}M units)")


if __name__ == "__main__":
    main()
