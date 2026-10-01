#!/usr/bin/env python3
# assemble_session.py <dir> [SESSION_ID]
# Concatenates flush.*.md round files into two session documents:
#   session.<BASE>.md           — thinking blocks omitted
#   session_complete.<BASE>.md  — thinking blocks included
# BASE = SESSION_ID.SERVICE.<assembly date/time>.HOSTNAME (matches handoff
# naming; assembly time plays the role of the handoff's export time).
# Strips the per-round forensic header; separators between rounds are ----.
import re
import sys
import time
from pathlib import Path

if len(sys.argv) < 2:
    sys.exit("usage: assemble_session.py <dir-containing-flush-files> [SESSION_ID]")
d = Path(sys.argv[1])
sid = sys.argv[2] if len(sys.argv) > 2 else None

by_session = {}
for f in sorted(d.glob('flush.*.md')):
    parts = f.name.split('.')
    if len(parts) < 8 or parts[0] != 'flush':
        continue
    by_session.setdefault(parts[1], []).append(f)

if not by_session:
    sys.exit(f"no flush.*.md files in {d}")
if sid is None:
    if len(by_session) == 1:
        sid = next(iter(by_session))
    else:
        sys.exit("multiple sessions present — pass SESSION_ID: " + ', '.join(by_session))
if sid not in by_session:
    sys.exit(f"session {sid} not found; present: {', '.join(by_session)}")

rounds = sorted(by_session[sid], key=lambda f: int(f.name.split('.')[-2]))

HDR = re.compile(r'^# AI Forensic Log\n(?:.*\n)*?\n(?=## User Prompt)', re.M)
THINK = re.compile(r'\n## AI Thinking\n.*?(?=\n## AI Response\n)', re.S)

def round_text(f, keep_thinking):
    t = f.read_text()
    t = HDR.sub('', t, count=1)                 # drop forensic header block
    if not keep_thinking:
        t = THINK.sub('', t, count=1)           # drop ## AI Thinking section
    return t.strip('\n')

m = re.search(r'\*\*Session Name:\*\* (.*)', rounds[0].read_text())
name = m.group(1).strip() if m else sid

parts = rounds[-1].name.split('.')
svc, host = parts[2], parts[5]
base = f'{sid}.{svc}.{time.strftime("%Y-%m-%d.%H-%M-%S")}.{host}'
sep = '\n\n----\n\n'

complete = (f'# Session — {name}\n\n'
            f'{len(rounds)} rounds. Includes AI thinking blocks.\n\n'
            + sep.join(round_text(f, True) for f in rounds) + '\n')
brief = (f'# Session — {name}\n\n'
         f'{len(rounds)} rounds. Thinking omitted — see session_complete variant.\n\n'
         + sep.join(round_text(f, False) for f in rounds) + '\n')

(d / f'session_complete.{base}.md').write_text(complete)
(d / f'session.{base}.md').write_text(brief)
print(f'wrote session.{base}.md and session_complete.{base}.md ({len(rounds)} rounds)')
