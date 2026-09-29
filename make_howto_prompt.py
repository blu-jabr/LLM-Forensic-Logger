#!/usr/bin/env python3
"""make_howto_prompt.py — fill HOWTO_add_new_LLM_model.md placeholders from a JSON config.

Usage:
    python3 make_howto_prompt.py config.json              # print prompt to stdout
    python3 make_howto_prompt.py config.json | wl-copy    # or xclip -selection clipboard / pbcopy

config.json schema:
    {
      "llm_name": "Z.AI",            # human-readable service name
      "llm_url": "https://chat.z.ai",
      "module_name": "zai",          # must be a valid JS identifier
      "current_version": "1.29"      # optional; if absent, [CURRENT_VERSION] is left
    }
"""

import json
import re
import sys

TEMPLATE = "HOWTO_add_new_LLM_model.md"
JS_IDENTIFIER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")
LEFTOVER = re.compile(r"\[(?:INSERT [^\]]+|insert_module_name|CURRENT_VERSION)\]")

REQUIRED = ("llm_name", "llm_url", "module_name")
KNOWN = set(REQUIRED) | {"current_version"}


def die(msg, code=1):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def main():
    if len(sys.argv) != 2:
        die(f"usage: {sys.argv[0]} <config.json>")
    cfg_path = sys.argv[1]

    try:
        with open(cfg_path, encoding="utf-8") as f:
            cfg = json.load(f)
    except FileNotFoundError:
        die(f"config not found: {cfg_path}")
    except json.JSONDecodeError as e:
        die(f"{cfg_path} is not valid JSON: {e}")
    if not isinstance(cfg, dict):
        die("top-level JSON value must be an object")

    unknown = sorted(set(cfg) - KNOWN)
    if unknown:
        print(f"warning: unknown keys ignored: {', '.join(unknown)}", file=sys.stderr)

    missing = [k for k in REQUIRED if k not in cfg]
    if missing:
        die(f"missing required keys: {', '.join(missing)}")

    llm_name = str(cfg["llm_name"]).strip()
    llm_url = str(cfg["llm_url"]).strip()
    module_name = str(cfg["module_name"]).strip()
    current_version = str(cfg.get("current_version", "")).strip()

    if not llm_name:
        die("llm_name is empty")
    if not llm_url:
        die("llm_url is empty")
    if not JS_IDENTIFIER.match(module_name):
        die(f"module_name {module_name!r} is not a valid JS identifier "
            f"(it becomes window.ForensicModules.<name>)")

    try:
        with open(TEMPLATE, encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        die(f"template not found: {TEMPLATE} (run from the extension directory)")

    text = (text
            .replace("[INSERT LLM NAME]", llm_name)
            .replace("[INSERT LLM URL]", llm_url)
            .replace("[insert_module_name]", module_name))

    if current_version:
        if not re.match(r"^\d+\.\d+", current_version):
            print(f"warning: current_version {current_version!r} does not look like a semver",
                  file=sys.stderr)
        text = text.replace("[CURRENT_VERSION]", current_version)
    else:
        print("warning: current_version absent; [CURRENT_VERSION] left unsubstituted",
              file=sys.stderr)

    leftovers = sorted(set(LEFTOVER.findall(text)))
    if leftovers:
        print(f"warning: unresolved placeholders remain: {', '.join(leftovers)}", file=sys.stderr)

    # Chat-transport invariant: this output gets pasted into an LLM session,
    # where a line starting with ``` breaks the enclosing code fence (the
    # plugin.txt lesson). The template uses indented code blocks; warn if a
    # future edit reintroduces a fence.
    for i, line in enumerate(text.splitlines(), 1):
        if line.startswith("```"):
            print(f"warning: line {i} starts with a ``` fence — will break when "
                  f"pasted into chat; use a 4-space-indented block instead",
                  file=sys.stderr)

    sys.stdout.write(text)


if __name__ == "__main__":
    main()
