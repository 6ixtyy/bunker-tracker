#!/usr/bin/env node
// Builds site/addresses.html from site/template.html and one page per site/src/*.html.
// The home page, site/index.html, is a copy of the page named in HOME.
// Styles, scripts and the snapshot are inlined, and each page's scripts are run
// once here so the charts are already in the HTML: the pages then display even
// where scripts do not run (for example a static file preview).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(ROOT, "site"), src = path.join(site, "src");
const read = f => fs.readFileSync(f, "utf8");
const blob = JSON.stringify(JSON.parse(read(path.join(ROOT, "data", "latest.json")))).replace(/<\//g, "<\\/");
const escText = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// Just enough DOM to capture what the page scripts write.
function fakeDom(name) {
  const byId = {}, body = { afterbegin: "", beforeend: "" };
  const node = () => ({ style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, addEventListener() {}, appendChild() {}, querySelectorAll: () => [], querySelector: () => null });
  const document = {
    getElementById: id => (byId[id] ??= node()),
    querySelector: () => null, querySelectorAll: () => [], createElement: node, addEventListener() {},
    body: { ...node(), insertAdjacentHTML: (where, html) => { body[where] += html; } },
  };
  const sandbox = { document, location: { pathname: "/" + name }, innerWidth: 1200, innerHeight: 800, console };
  sandbox.window = sandbox;
  return { sandbox, byId, body };
}

function build(name, html) {
  const scripts = [];
  html.replace(/<script>([\s\S]*?)<\/script>/g, (_, code) => { scripts.push(code); return ""; });
  const { sandbox, byId, body } = fakeDom(name);
  vm.runInNewContext(scripts.join("\n;\n"), sandbox, { filename: name });
  for (const [id, el] of Object.entries(byId)) {
    const content = el.innerHTML ?? (el.textContent !== undefined ? escText(el.textContent) : null);
    if (content === null) continue;
    const empty = new RegExp(`(<(\\w+)[^>]*\\bid="${id}"[^>]*>)(</\\2>)`);
    if (!empty.test(html)) throw new Error(`${name}: no empty element with id="${id}"`);
    html = html.replace(empty, (_, open, tag, close) => open + content + close);
  }
  html = html.replace(/<body>/, m => m + "\n" + body.afterbegin);
  if (body.beforeend) html = html.replace(/<\/main>/, m => m + "\n" + body.beforeend);
  fs.writeFileSync(path.join(site, name), html);
  console.error(`built site/${name}`);
}

const HOME = "ultra2.html";
const snapshot = `<script>window.SNAP = ${blob};</script>`;
build("addresses.html", read(path.join(site, "template.html")).replace("const SNAP = /*__SNAPSHOT__*/null;", () => `const SNAP = ${blob};`));
const inline = {
  '<link rel="stylesheet" href="style.css">': `<style>\n${read(path.join(src, "style.css"))}</style>`,
  '<script src="data.js"></script>': snapshot,
  '<script src="common.js"></script>': `<script>\n${read(path.join(src, "common.js"))}</script>`,
  '<script src="shell.js"></script>': `<script>\n${read(path.join(src, "shell.js"))}</script>`,
};
for (const page of fs.readdirSync(src).filter(f => f.endsWith(".html")).sort()) {
  let html = read(path.join(src, page));
  for (const [tag, content] of Object.entries(inline)) html = html.replace(tag, () => content);
  if (/<(script|link)[^>]+(src|href)="(?!https?:)[^"]+\.(js|css)"/.test(html)) throw new Error(`${page} still references a local file`);
  build(page, html);
}
fs.copyFileSync(path.join(site, HOME), path.join(site, "index.html"));
console.error(`built site/index.html (copy of ${HOME})`);
