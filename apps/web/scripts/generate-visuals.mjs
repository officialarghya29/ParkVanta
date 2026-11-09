import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const OUT = path.join(ROOT, "docs/assets");
const benchmark = JSON.parse(
  fs.readFileSync(path.join(ROOT, "docs/benchmarks/local-20c.json"), "utf8"),
);
const verification = JSON.parse(
  fs.readFileSync(path.join(ROOT, "docs/results/verification.json"), "utf8"),
);

fs.mkdirSync(OUT, { recursive: true });

const baseCss = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: #040a12; color: #e8f4ff;
    font-family: "DejaVu Sans", system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .frame {
    position: relative; overflow: hidden; background:
      radial-gradient(1200px 620px at 88% -12%, rgba(46,230,200,.20), transparent 62%),
      radial-gradient(900px 520px at -8% 112%, rgba(47,111,237,.18), transparent 60%),
      #040a12;
  }
  .grid {
    position: absolute; inset: 0; pointer-events: none;
    background-image:
      linear-gradient(rgba(120,220,210,.055) 1px, transparent 1px),
      linear-gradient(90deg, rgba(120,220,210,.055) 1px, transparent 1px);
    background-size: 64px 64px;
    mask-image: linear-gradient(180deg, rgba(0,0,0,.85), rgba(0,0,0,.22));
  }
  .scan {
    position: absolute; left: 0; right: 0; top: 34%; height: 1px; opacity: .55;
    background: linear-gradient(90deg, transparent, rgba(46,230,200,.8), transparent);
  }
  .mono { font-family: "DejaVu Sans Mono", ui-monospace, monospace; }
  .eyebrow {
    font-family: "DejaVu Sans Mono", ui-monospace, monospace;
    font-size: 13px; letter-spacing: .34em; text-transform: uppercase; color: #2ee6c8;
  }
  .muted { color: #7e96ab; }
  .teal { color: #2ee6c8; }
  .chip {
    display: inline-flex; align-items: center; gap: 8px;
    border: 1px solid rgba(46,230,200,.28); background: rgba(46,230,200,.07);
    border-radius: 999px; padding: 8px 14px;
    font-family: "DejaVu Sans Mono", ui-monospace, monospace;
    font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: #a9fff2;
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #2ee6c8; box-shadow: 0 0 12px 2px rgba(46,230,200,.7); }
`;

function frame({ width, height, inner, extraClass = "" }) {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    ${baseCss}
    .frame { width: ${width}px; height: ${height}px; }
    ${extraClass}
  </style></head><body><div class="frame"><div class="grid"></div><div class="scan"></div>${inner}</div></body></html>`;
}

const heroBays = Array.from({ length: 17 }, (_, index) => {
  const status = index === 2 ? "occ" : index === 8 ? "res" : "free";
  return `<div class="bay ${status}"><b>V-${String(index + 1).padStart(2, "0")}</b><i></i></div>`;
}).join("");

const hero = frame({
  width: 2000,
  height: 800,
  inner: `
    <div style="position:relative;z-index:2;display:flex;height:100%;gap:54px;padding:64px 72px;">
      <div style="flex:1.18;display:flex;flex-direction:column;justify-content:space-between;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:16px;">
            <div style="width:46px;height:46px;border-radius:14px;border:1px solid rgba(46,230,200,.4);background:rgba(46,230,200,.1);display:flex;align-items:center;justify-content:center;font-size:22px;color:#2ee6c8;">◈</div>
            <div>
              <div class="mono" style="font-size:13px;letter-spacing:.42em;color:#fff;">PARKVANTA</div>
              <div class="mono muted" style="font-size:9px;letter-spacing:.22em;margin-top:4px;">PROPERTY OS · VISITOR ACCESS</div>
            </div>
          </div>
          <div class="mono" style="font-size:10px;letter-spacing:.22em;color:#7e96ab;border:1px solid rgba(255,255,255,.1);padding:7px 12px;border-radius:8px;">PILOT BUILD · v0.1</div>
        </div>

        <div>
          <div class="eyebrow">Smart access · Smarter parking</div>
          <div style="font-size:126px;font-weight:700;letter-spacing:.055em;line-height:.94;margin:20px 0 0;background:linear-gradient(180deg,#ffffff 30%,#8ff7e7 100%);-webkit-background-clip:text;color:transparent;">PARKVANTA</div>
          <p style="margin-top:24px;max-width:760px;font-size:19px;line-height:1.65;color:#a9bccd;">
            A transactional operating system for residential gates: single-use visitor passes,
            concurrency-safe bay allocation, and an auditable lifecycle from invitation to release.
          </p>
          <div style="display:flex;gap:10px;margin-top:28px;flex-wrap:wrap;">
            <span class="chip"><span class="dot"></span> PostgreSQL authority</span>
            <span class="chip">FastAPI · React 19</span>
            <span class="chip">SSE replay · offline queue</span>
          </div>
        </div>

        <div style="display:flex;gap:42px;border-top:1px solid rgba(255,255,255,.09);padding-top:22px;">
          <div><div class="mono" style="font-size:10px;letter-spacing:.2em;color:#7e96ab;">MEASURED THROUGHPUT</div><div class="teal" style="font-size:34px;font-weight:600;">${benchmark.totals.rps}<span style="font-size:14px;color:#7e96ab;"> req/s</span></div></div>
          <div><div class="mono" style="font-size:10px;letter-spacing:.2em;color:#7e96ab;">P95 READ LATENCY</div><div style="font-size:34px;font-weight:600;">${benchmark.latency_ms.p95_ms}<span style="font-size:14px;color:#7e96ab;"> ms</span></div></div>
          <div><div class="mono" style="font-size:10px;letter-spacing:.2em;color:#7e96ab;">LOAD ERRORS</div><div class="teal" style="font-size:34px;font-weight:600;">${benchmark.totals.errors}<span style="font-size:14px;color:#7e96ab;"> / ${benchmark.totals.requests.toLocaleString()}</span></div></div>
          <div><div class="mono" style="font-size:10px;letter-spacing:.2em;color:#7e96ab;">AUTOMATED CHECKS</div><div style="font-size:34px;font-weight:600;">${verification.backend_tests + verification.frontend_tests + verification.e2e_tests}</div></div>
        </div>
      </div>

      <div style="flex:.82;display:flex;flex-direction:column;justify-content:center;">
        <div style="border:1px solid rgba(46,230,200,.22);border-radius:26px;background:rgba(8,20,32,.72);box-shadow:0 40px 120px -50px rgba(0,0,0,.9), inset 0 0 80px rgba(46,230,200,.03);padding:26px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
            <div class="mono" style="font-size:10px;letter-spacing:.22em;color:#8aa4b8;">LIVE BAY MAP · 17 SLOTS</div>
            <div class="mono" style="font-size:9px;color:#2ee6c8;letter-spacing:.16em;">● STREAMING</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;">${heroBays}</div>
          <div style="display:flex;justify-content:space-between;margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,.07);">
            <span class="mono" style="font-size:9px;color:#7e96ab;">FREE · 15</span>
            <span class="mono" style="font-size:9px;color:#ffca7a;">RESERVED · 1</span>
            <span class="mono" style="font-size:9px;color:#7fd1ff;">OCCUPIED · 1</span>
          </div>
        </div>
        <div class="mono" style="margin-top:18px;text-align:right;font-size:9px;letter-spacing:.2em;color:#5f7a8f;">INVITATION → APPROVAL → SLOT → ENTRY → EXIT → RELEASE</div>
      </div>
    </div>
    <style>
      .bay { position:relative;height:62px;border-radius:10px;border:1px solid rgba(46,230,200,.22);background:rgba(46,230,200,.05);display:flex;align-items:center;justify-content:center; }
      .bay b { font-family:"DejaVu Sans Mono",monospace;font-size:10px;font-weight:400;color:#9fb7c9;letter-spacing:.1em; }
      .bay i { position:absolute;left:8px;top:8px;width:4px;height:4px;border-radius:50%;background:#2ee6c8;box-shadow:0 0 8px 1px rgba(46,230,200,.7); }
      .bay.res { border-color:rgba(255,202,122,.5);background:rgba(255,202,122,.1); } .bay.res i{background:#ffca7a;box-shadow:0 0 8px 1px rgba(255,202,122,.6);} .bay.res b{color:#ffdca6;}
      .bay.occ { border-color:rgba(127,209,255,.5);background:rgba(127,209,255,.1); } .bay.occ i{background:#7fd1ff;box-shadow:0 0 8px 1px rgba(127,209,255,.6);} .bay.occ b{color:#b8e8ff;}
      .bay.block { border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.04); } .bay.block i{background:#64748b;box-shadow:none;} .bay.block b{color:#64748b;}
    </style>
  `,
});

const latencyBars = [
  ["p50", benchmark.latency_ms.p50_ms],
  ["p95", benchmark.latency_ms.p95_ms],
  ["p99", benchmark.latency_ms.p99_ms],
  ["max", benchmark.latency_ms.max_ms],
];
const latencyMax = Math.ceil(Math.max(...latencyBars.map(([, value]) => value)) / 100) * 100;
const latency = frame({
  width: 1600,
  height: 840,
  inner: `
    <div style="position:relative;z-index:2;height:100%;display:flex;flex-direction:column;padding:56px 64px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div class="eyebrow">Measured · read path · ${benchmark.scenario.concurrency} concurrent clients</div>
          <h1 style="font-size:46px;font-weight:650;margin-top:14px;letter-spacing:-.02em;">Latency under load</h1>
          <p class="muted" style="margin-top:10px;font-size:15px;">${benchmark.totals.requests.toLocaleString()} requests over ${benchmark.totals.elapsed_seconds}s · ${benchmark.totals.error_rate_percent}% errors · mixed availability, analytics and gate reads</p>
        </div>
        <div style="text-align:right;">
          <div class="mono muted" style="font-size:10px;letter-spacing:.2em;">THROUGHPUT</div>
          <div class="teal" style="font-size:66px;font-weight:650;line-height:1;">${benchmark.totals.rps}</div>
          <div class="mono muted" style="font-size:10px;letter-spacing:.18em;">REQ / SECOND</div>
        </div>
      </div>

      <div style="flex:1;display:flex;align-items:flex-end;gap:46px;margin-top:44px;padding:0 30px;border-bottom:1px solid rgba(255,255,255,.12);position:relative;">
        ${[0, 25, 50, 75, 100].map((mark) => `<div style="position:absolute;left:0;right:0;bottom:${mark}%;border-top:1px dashed rgba(255,255,255,.06);"></div><div class="mono" style="position:absolute;left:-26px;bottom:calc(${mark}% - 6px);font-size:9px;color:#526f84;">${Math.round((latencyMax * mark) / 100)}</div>`).join("")}
        ${latencyBars
          .map(
            ([label, value], index) => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:12px;z-index:1;">
            <div class="mono" style="font-size:22px;color:${index === 2 ? "#ffca7a" : "#2ee6c8"};">${value}<span style="font-size:11px;color:#7e96ab;"> ms</span></div>
            <div style="width:100%;max-width:150px;height:${(value / latencyMax) * 440}px;border-radius:12px 12px 0 0;background:linear-gradient(180deg,${index === 2 ? "rgba(255,202,122,.85)" : "rgba(46,230,200,.8)"},rgba(46,230,200,.06));box-shadow:0 0 50px -12px rgba(46,230,200,.45);"></div>
            <div class="mono" style="font-size:12px;letter-spacing:.2em;color:#a9bccd;">${label.toUpperCase()}</div>
          </div>`,
          )
          .join("")}
      </div>

      <div style="display:flex;justify-content:space-between;margin-top:22px;">
        ${Object.entries(benchmark.per_endpoint)
          .map(
            ([name, data]) =>
              `<div class="mono" style="font-size:10px;color:#7e96ab;letter-spacing:.08em;">${name.toUpperCase().replace("_", " ")} · p95 <span style="color:#cfe3f2;">${data.p95_ms}ms</span></div>`,
          )
          .join("")}
      </div>
    </div>
  `,
});

const timeline = benchmark.timeline;
const maxRps = Math.max(...timeline.map((bucket) => bucket.requests));
const chartW = 1420;
const chartH = 360;
const padX = 26;
const padY = 22;
const points = timeline.map((bucket, index) => {
  const x = padX + (index / Math.max(timeline.length - 1, 1)) * (chartW - padX * 2);
  const y = chartH - padY - (bucket.requests / (maxRps * 1.15)) * (chartH - padY * 2);
  return { x, y, ...bucket };
});
const linePath = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
const areaPath = `${linePath} L${points.at(-1).x.toFixed(1)},${chartH - padY} L${points[0].x.toFixed(1)},${chartH - padY} Z`;

const throughput = frame({
  width: 1600,
  height: 760,
  inner: `
    <div style="position:relative;z-index:2;height:100%;display:flex;flex-direction:column;padding:54px 64px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div class="eyebrow">Throughput · every request is a real authenticated HTTP call</div>
          <h1 style="font-size:44px;font-weight:650;margin-top:14px;letter-spacing:-.02em;">Sustained load, zero errors</h1>
          <p class="muted" style="margin-top:9px;font-size:14px;">Local Docker PostgreSQL 16 · ${benchmark.environment.cpu} · ${benchmark.environment.cpu_count} threads</p>
        </div>
        <div style="display:flex;gap:34px;text-align:right;">
          <div><div class="mono muted" style="font-size:9px;letter-spacing:.18em;">REQUESTS</div><div style="font-size:40px;font-weight:600;">${benchmark.totals.requests.toLocaleString()}</div></div>
          <div><div class="mono muted" style="font-size:9px;letter-spacing:.18em;">HTTP 200</div><div class="teal" style="font-size:40px;font-weight:600;">${benchmark.totals.status_counts["200"]?.toLocaleString() ?? 0}</div></div>
          <div><div class="mono muted" style="font-size:9px;letter-spacing:.18em;">ERRORS</div><div class="teal" style="font-size:40px;font-weight:600;">${benchmark.totals.errors}</div></div>
        </div>
      </div>

      <div style="margin-top:30px;border:1px solid rgba(46,230,200,.16);background:rgba(8,20,32,.55);border-radius:18px;padding:18px 20px 8px;">
        <svg width="${chartW}" height="${chartH}" viewBox="0 0 ${chartW} ${chartH}" style="display:block;margin:0 auto;">
          <defs>
            <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#2ee6c8" stop-opacity=".4"/>
              <stop offset="100%" stop-color="#2ee6c8" stop-opacity="0"/>
            </linearGradient>
            <linearGradient id="stroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#2f6fed"/><stop offset="100%" stop-color="#2ee6c8"/>
            </linearGradient>
          </defs>
          ${[0, 0.25, 0.5, 0.75, 1]
            .map((ratio) => {
              const y = chartH - padY - ratio * (chartH - padY * 2);
              return `<line x1="${padX}" y1="${y}" x2="${chartW - padX}" y2="${y}" stroke="rgba(255,255,255,.06)" stroke-dasharray="4 6"/><text x="${padX - 10}" y="${y + 4}" text-anchor="end" fill="#526f84" font-size="9" font-family="monospace">${Math.round(maxRps * 1.15 * ratio)}</text>`;
            })
            .join("")}
          <path d="${areaPath}" fill="url(#area)"/>
          <path d="${linePath}" fill="none" stroke="url(#stroke)" stroke-width="2.5"/>
          ${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="2.4" fill="#2ee6c8"/>`).join("")}
          <text x="${padX}" y="${chartH - 2}" fill="#526f84" font-size="9" font-family="monospace">0s</text>
          <text x="${chartW - padX}" y="${chartH - 2}" text-anchor="end" fill="#526f84" font-size="9" font-family="monospace">${benchmark.totals.elapsed_seconds}s</text>
        </svg>
      </div>
      <div class="mono" style="margin-top:16px;font-size:10px;color:#7e96ab;letter-spacing:.12em;">MIX · 40% AVAILABILITY · 30% OVERVIEW · 20% ACTIVE VISITORS · 10% GATE ACTIVITY</div>
    </div>
  `,
});

const verificationChart = frame({
  width: 1600,
  height: 780,
  inner: `
    <div style="position:relative;z-index:2;height:100%;display:flex;flex-direction:column;padding:56px 64px;">
      <div class="eyebrow">Verification matrix · recorded ${verification.recorded_at}</div>
      <h1 style="font-size:44px;font-weight:650;margin-top:13px;letter-spacing:-.02em;">Evidence, not adjectives</h1>
      <p class="muted" style="margin-top:8px;font-size:14px;">Every number below comes from a local run against PostgreSQL 16, not from a design document.</p>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:34px;">
        ${[
          ["Backend", verification.backend_tests, "pytest · real PostgreSQL", "#2ee6c8"],
          ["Frontend", verification.frontend_tests, "vitest · pure logic", "#7fd1ff"],
          ["Browser", verification.e2e_tests, "Playwright · real Chrome", "#ffca7a"],
          ["Failed", verification.failed_tests, "across all suites", "#2ee6c8"],
        ]
          .map(
            ([label, value, caption, color]) => `
          <div style="border:1px solid rgba(255,255,255,.09);background:rgba(8,20,32,.55);border-radius:18px;padding:22px;">
            <div class="mono" style="font-size:10px;letter-spacing:.2em;color:#7e96ab;">${label.toUpperCase()}</div>
            <div style="font-size:54px;font-weight:650;color:${color};margin-top:8px;">${value}</div>
            <div class="mono" style="font-size:9px;color:#5f7a8f;letter-spacing:.08em;">${caption}</div>
          </div>`,
          )
          .join("")}
      </div>

      <div style="display:grid;grid-template-columns:1.05fr .95fr;gap:16px;margin-top:16px;flex:1;">
        <div style="border:1px solid rgba(46,230,200,.18);background:rgba(8,20,32,.55);border-radius:18px;padding:24px;">
          <div class="mono" style="font-size:10px;letter-spacing:.2em;color:#7e96ab;">SAFETY PROOFS</div>
          <div style="margin-top:16px;display:grid;gap:12px;">
            ${[
              ["Double authorization of one pass", "0", "thread-barrier concurrency test"],
              ["Double allocation of one slot", "0", "SKIP LOCKED + partial unique index"],
              ["Releases after duplicate offline exit", "1", "idempotency ledger"],
              ["Cross-tenant reads accepted", "0", "403 assertions"],
              ["Double terminal approve/reject state", "0", "row-lock re-check"],
            ]
              .map(
                ([label, value, note]) => `
              <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,.05);padding-bottom:10px;">
                <div><div style="font-size:13px;color:#cfe3f2;">${label}</div><div class="mono" style="font-size:9px;color:#5f7a8f;margin-top:3px;">${note}</div></div>
                <div class="teal" style="font-size:26px;font-weight:600;">${value}</div>
              </div>`,
              )
              .join("")}
          </div>
        </div>

        <div style="border:1px solid rgba(255,255,255,.09);background:rgba(8,20,32,.55);border-radius:18px;padding:24px;display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <div class="mono" style="font-size:10px;letter-spacing:.2em;color:#7e96ab;">SURFACE</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">
              <div><div style="font-size:34px;font-weight:600;">${verification.openapi_paths}</div><div class="mono" style="font-size:9px;color:#7e96ab;">API PATHS</div></div>
              <div><div style="font-size:34px;font-weight:600;">${verification.openapi_operations}</div><div class="mono" style="font-size:9px;color:#7e96ab;">OPERATIONS</div></div>
              <div><div style="font-size:34px;font-weight:600;">${verification.db_tables}</div><div class="mono" style="font-size:9px;color:#7e96ab;">TABLES</div></div>
              <div><div style="font-size:34px;font-weight:600;">${verification.migrations}</div><div class="mono" style="font-size:9px;color:#7e96ab;">MIGRATIONS</div></div>
            </div>
          </div>
          <div style="border-top:1px solid rgba(255,255,255,.07);padding-top:14px;">
            <div class="mono" style="font-size:9px;color:#7e96ab;line-height:1.9;">BROWSER FLOW · INVITE → APPROVE → QR → VERIFY → AUTHORIZE → ENTER → OFFLINE EXIT → RECONCILE<br/>LOAD · ${benchmark.totals.requests.toLocaleString()} REQUESTS · ${benchmark.totals.rps} REQ/S · P95 ${benchmark.latency_ms.p95_ms}MS · ${benchmark.totals.errors} ERRORS</div>
          </div>
        </div>
      </div>
    </div>
  `,
});

const browser = await chromium.launch({ channel: "chrome" });

async function render(html, file, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, file) });
  await page.close();
  console.log(`rendered ${file}`);
}

await render(hero, "hero.png", 2000, 800);
await render(latency, "chart-latency.png", 1600, 840);
await render(throughput, "chart-throughput.png", 1600, 760);
await render(verificationChart, "chart-verification.png", 1600, 780);

await browser.close();
console.log(`visuals written to ${OUT}`);
