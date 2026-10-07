#!/usr/bin/env python3
"""One-shot Bunker Tracker snapshot.

Reads registry/btc/*.yaml, asks a public Esplora API for each address's
funded/spent totals, classifies it as exposed or hidden, and writes
data/snapshot-<date>.json, data/latest.json and site/index.html.

Exposure rules applied here (address level):
  - taproot:       the address is P2TR, so the output key is on chain
  - spent_address: the address has at least one confirmed spend
  - pubkey_published: the registry says the org disclosed the key or script
    off chain (signed message, published redeem script)
Mempool spends, P2PK/bare multisig and key reuse across addresses are not
checked yet.
"""
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
APIS = ["https://blockstream.info/api", "https://mempool.space/api"]
SATS = 100_000_000


def get(path, tries=4):
    last = None
    for attempt in range(tries):
        for base in APIS:
            try:
                req = urllib.request.Request(base + path, headers={"User-Agent": "bunker-tracker/0.1"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    return r.read().decode()
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                last = e
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"all APIs failed for {path}: {last}")


B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _bech32_polymod(values):
    chk = 1
    for v in values:
        top = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ v
        for i, g in enumerate((0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3)):
            if (top >> i) & 1:
                chk ^= g
    return chk


def script_type(addr):
    """Return the script type of a mainnet address, verifying its checksum."""
    if addr.lower().startswith("bc1"):
        a = addr.lower()
        if a != addr or any(c not in B32 for c in a[3:]):
            raise ValueError(f"malformed bech32 address: {addr}")
        data = [B32.index(c) for c in a[3:]]
        check = _bech32_polymod([3, 3, 0, 2, 3] + data)  # hrp "bc" expanded
        version, size = data[0], (len(data) - 7) * 5 // 8
        if version == 0 and check == 1 and size in (20, 32):
            return "p2wpkh" if size == 20 else "p2wsh"
        if version == 1 and check == 0x2BC830A3 and size == 32:
            return "p2tr"
        raise ValueError(f"bad bech32 checksum or program: {addr}")
    n = 0
    for c in addr:
        if c not in B58:
            raise ValueError(f"malformed base58 address: {addr}")
        n = n * 58 + B58.index(c)
    raw = n.to_bytes(25, "big") if n < 1 << 200 else b""
    if len(raw) != 25 or hashlib.sha256(hashlib.sha256(raw[:21]).digest()).digest()[:4] != raw[21:]:
        raise ValueError(f"bad base58 checksum: {addr}")
    if raw[0] == 0x00:
        return "p2pkh"
    if raw[0] == 0x05:
        return "p2sh"
    raise ValueError(f"not a mainnet address: {addr}")


def classify(entry):
    addr = entry["address"]
    stype = script_type(addr)
    stats = json.loads(get(f"/address/{addr}"))["chain_stats"]
    if stype == "p2tr":
        reason = "taproot"
    elif stats["spent_txo_count"] > 0:
        reason = "spent_address"
    elif entry.get("pubkey_published"):
        reason = "pubkey_published"
    else:
        reason = None
    return {
        "address": addr,
        "role": entry["role"],
        "script_type": stype,
        "balance_sats": stats["funded_txo_sum"] - stats["spent_txo_sum"],
        "utxo_count": stats["funded_txo_count"] - stats["spent_txo_count"],
        "spent_txo_count": stats["spent_txo_count"],
        "exposed": reason is not None,
        "reason": reason,
        "source_url": entry["source_url"],
        "notes": entry.get("notes", ""),
    }


def totals(rows):
    exposed = sum(r["balance_sats"] for r in rows if r["exposed"])
    total = sum(r["balance_sats"] for r in rows)
    return {
        "total_btc": total / SATS,
        "exposed_btc": exposed / SATS,
        "hidden_btc": (total - exposed) / SATS,
        "exposed_pct": round(100 * exposed / total, 4) if total else None,
        "address_count": sum(1 for r in rows if r["balance_sats"] > 0),
        "utxo_count": sum(r["utxo_count"] for r in rows),
    }


def snapshot_org(path):
    doc = yaml.safe_load(path.read_text())
    org = doc["org"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(classify, doc.get("addresses") or []))
    rows.sort(key=lambda r: -r["balance_sats"])

    # The headline covers long-term holdings (cold storage and treasury). If the
    # org does not say what its addresses are for, fall back to everything it
    # published and say so.
    held = [r for r in rows if r["role"] in ("cold", "treasury")]
    roles = sorted({r["role"] for r in held}) or None
    basis = "+".join(roles) if roles else "all_tracked"
    headline_rows = held if held else rows

    breakdown = {}
    for r in headline_rows:
        if r["exposed"]:
            breakdown[r["reason"]] = breakdown.get(r["reason"], 0) + r["balance_sats"]
    breakdown = {k: v / SATS for k, v in breakdown.items()}

    claim = org.get("claimed_reserves") or {}
    return {
        "slug": org["slug"],
        "name": org["name"],
        "website": org["website"],
        "headline_basis": basis,
        "headline_roles": roles,
        "scope": org.get("scope"),
        "research_note": org.get("research_note"),
        "headline": totals(headline_rows),
        "hot": totals([r for r in rows if r["role"] == "hot"]),
        "all_tracked": totals(rows),
        "exposure_breakdown_btc": breakdown,
        "claimed_reserves": claim or None,
        "sources": sorted({r["source_url"] for r in rows}),
        "addresses": rows,
    }


def render():
    """Build the site pages from data/latest.json (see scripts/prerender.mjs)."""
    subprocess.run(["node", str(ROOT / "scripts" / "prerender.mjs")], check=True)


def main():
    # --render rebuilds the pages from the last snapshot without refetching.
    if "--render" in sys.argv:
        render()
        return
    height = int(get("/blocks/tip/height"))
    block_hash = get(f"/block-height/{height}").strip()
    now = datetime.datetime.now(datetime.timezone.utc)

    orgs = []
    for path in sorted((ROOT / "registry" / "btc").glob("*.yaml")):
        print(f"snapshotting {path.stem} ...", file=sys.stderr)
        orgs.append(snapshot_org(path))
    orgs.sort(key=lambda o: -o["headline"]["total_btc"])

    snap = {
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        # Esplora address totals cannot be pinned to a height, so this is the
        # tip when the run started; balances may include a block or two after.
        "tip_height": height,
        "tip_hash": block_hash,
        "rules": ["taproot", "spent_address", "pubkey_published"],
        "orgs": orgs,
    }

    data = ROOT / "data"
    data.mkdir(exist_ok=True)
    text = json.dumps(snap, indent=2)
    (data / f"snapshot-{now:%Y-%m-%d}.json").write_text(text)
    (data / "latest.json").write_text(text)

    render()

    for o in orgs:
        h = o["headline"]
        if not o["addresses"]:
            print(f"{o['name']:10} no publicly verifiable addresses")
            continue
        print(f"{o['name']:10} {o['headline_basis']:12} total {h['total_btc']:>12,.2f}  "
              f"exposed {h['exposed_btc']:>12,.2f}  hidden {h['hidden_btc']:>10,.2f}  {h['exposed_pct']}%")


if __name__ == "__main__":
    main()
