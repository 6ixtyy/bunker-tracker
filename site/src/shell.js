// Page chrome shared by v1–v4: header, version switch, legend, footer. Expects common.js.
(function () {
  if (document.querySelector("header")) return; // already in the prebuilt HTML
  const here = location.pathname.split("/").pop() || "v1.html";
  const views = [["v1.html", "Rings"], ["v2.html", "Bars"], ["v3.html", "Towers"], ["v4.html", "Dots"]];
  document.body.insertAdjacentHTML("afterbegin", `<header><span class="brand">Bunker Tracker</span>
    <nav aria-label="View">${views.map(([f, n]) => `<a href="${f}"${f === here ? ' aria-current="page"' : ""}>${n}</a>`).join("")}</nav></header>`);
  document.body.insertAdjacentHTML("beforeend", `<footer>
    <div class="key"><span><i style="background:var(--x)"></i>Exposed</span><span><i style="background:var(--h)"></i>Hidden</span></div>
    <span>Block ${fmt(SNAP.tip_height)} · not a vulnerability today</span></footer>`);
})();
const orgTip = o => esc(`<b>${esc(o.name)}</b><span><i style="background:var(--x)"></i>${fmt(o.exposedBtc)} BTC exposed</span>` +
  `<span><i style="background:var(--h)"></i>${fmt(o.hiddenBtc)} BTC hidden</span>`);
