# LLM Forensic Logger — session boot (v2.0)

Read these first, in order, before any work:

1. `HOWTO_add_new_LLM_model.md` — architecture, module contract, deviation ledger D1–D17 (`content.js`/`background.js` are frozen except via ledger deviations, which require my approval), conventions, process notes, and the "Project state & parked board" section at the end.
2. `notes/WIRE_CAPTURE_PLAYBOOK.md` — required reading before any wire work.
3. `README.md` / `CHANGELOG.md` — capabilities, layout, limitations, history.

Working setup: dev directory is the source of truth; `make_plugin.sh` builds `plugin.txt` (22 chunks); test dir = clean unpack + reload extension + refresh target tab. Hostname is set per-machine in extension options BEFORE loading a page. `seacouver` is the git origin.

Tell me what you want to work on; if it's a parked board item, restate itfrom the HOWTO section so we're aligned before starting.
