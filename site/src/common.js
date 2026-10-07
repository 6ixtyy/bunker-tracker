// Shared helpers for the chart pages. Expects window.SNAP from data.js.
const fmt = (n, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const btc = r => r.balance_sats / 1e8;
const short = a => a.slice(0, 7) + "…" + a.slice(-5);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const BASIS = { cold: "Cold storage", treasury: "Treasury", "cold+treasury": "Cold + treasury", all_tracked: "All published addresses" };
// Never show 100% while hidden funds remain, or 0% while exposed funds do.
const pct0 = p => p == null ? "–" : p > 99 && p < 100 ? "99" : p > 0 && p < 1 ? "1" : fmt(p, 0);
const WHY = { spent_address: "address has spent", taproot: "Taproot output", pubkey_published: "key published by the org" };

const ORGS = SNAP.orgs.map(o => {
  const rows = (o.headline_roles ? o.addresses.filter(r => o.headline_roles.includes(r.role)) : o.addresses)
    .filter(r => r.balance_sats > 0);
  const sum = g => g.reduce((s, r) => s + btc(r), 0);
  const exposed = rows.filter(r => r.exposed), hidden = rows.filter(r => !r.exposed);
  return { ...o, rows, exposed, hidden, exposedBtc: sum(exposed), hiddenBtc: sum(hidden), totalBtc: sum(rows),
    pct: o.headline.exposed_pct, label: o.scope || BASIS[o.headline_basis] };
});
const MAX_EXPOSED = Math.max(...ORGS.map(o => o.exposedBtc));
const MAX_HIDDEN = Math.max(...ORGS.map(o => o.hiddenBtc));
const META = `Block ${fmt(SNAP.tip_height)} · ${SNAP.generated_at.slice(0, 16).replace("T", " ")} UTC`;

// Split one state's addresses into blocks worth drawing plus one merged remainder.
function blocks(rows, isBig) {
  const big = rows.filter(isBig), rest = rows.filter(r => !isBig(r));
  const out = big.map(r => ({ v: btc(r), rows: [r] }));
  if (rest.length) out.push({ v: rest.reduce((s, r) => s + btc(r), 0), rows: rest, merged: true });
  return out;
}
function tipHtml(org, b, exposed) {
  const state = exposed ? "Exposed" : "Hidden";
  if (b.merged) return `<b>${esc(org.name)}</b><span>${b.rows.length} smaller addresses</span><i>${fmt(b.v, 2)} BTC · ${state}</i>`;
  const r = b.rows[0];
  return `<b>${esc(org.name)}</b><span>${esc(short(r.address))} · ${r.script_type.toUpperCase()}</span>` +
    `<i>${fmt(b.v, 2)} BTC · ${state}${r.reason ? " — " + WHY[r.reason] : " — never spent"}</i>`;
}

// One floating tooltip, driven by [data-tip] attributes.
(function () {
  const tip = document.createElement("div");
  tip.className = "tip"; tip.setAttribute("role", "tooltip"); tip.hidden = true;
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(tip));
  document.addEventListener("pointermove", e => {
    const el = e.target.closest && e.target.closest("[data-tip]");
    if (!el) { tip.hidden = true; return; }
    tip.innerHTML = el.dataset.tip; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, e.clientX + 14)) + "px";
    tip.style.top = (e.clientY + h + 24 > innerHeight ? e.clientY - h - 12 : e.clientY + 16) + "px";
  });
  document.addEventListener("pointerleave", () => { tip.hidden = true; });
})();
