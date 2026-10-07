# Bunker Tracker

How much of each institution's published Bitcoin sits at addresses whose public
key is already known, and how much is still hidden behind a hash.

Live: https://bunker-tracker.vercel.app

Exposure is not a vulnerability today. It measures preparedness against a
hypothetical future break of the signature scheme Bitcoin uses.

## How it works

- `registry/btc/<org>.yaml` lists addresses each organization published or
  publicly confirmed itself, with a source URL for every entry.
- `scripts/snapshot.py` checks every address's checksum, asks a public Esplora
  API for its funded and spent totals, and classifies it.
- An address is **exposed** if it is Taproot, has at least one confirmed spend,
  or the organization published its key or script off chain (for example a
  signed ownership message). Otherwise it is **hidden**.
- `scripts/prerender.mjs` builds the pages in `site/` from `site/template.html`
  and `site/src/`, with the snapshot baked in.

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/snapshot.py            # fetch and rebuild (needs Node)
.venv/bin/python scripts/snapshot.py --render   # rebuild pages from data/latest.json
```

Public explorers rate-limit, so a full run can take around 15 minutes.

## Known limits

- Hidden means no known exposure. An address that has never spent could still
  share a key with one that has; that cannot be checked from outside.
- Mempool spends and key reuse across addresses are not checked.
- Coverage differs by organization: Coinbase's entry is its cbBTC reserves
  only, Bitfinex's list was last updated in 2022, OKX is limited to the
  addresses holding at least 1 BTC in its file, and Tether's single address is
  sourced to a news report quoting its CEO because the original post has not
  been located.
- A falling exposed balance does not prove a migration: funds moved to
  addresses outside the published lists simply leave the tracker.

## Corrections

Open an issue with the address, the organization, and a link to a source the
organization itself published.

## License

MIT. See [LICENSE](LICENSE).
