#!/usr/bin/env python3
"""
deploy-note.py — the one-sentence note for a deploy (2026-10-10).

deploy.sh runs this in the background on the VPS while the images build:

    python3 scripts/deploy-note.py <from-sha> <to-sha>

It reads what is going out (commit messages, the changelog lines added, the
file list and a trimmed diff), asks Claude for ONE plain sentence, and prints
it. deploy.sh writes that sentence into the deploy history as note=..., and
owner -> Vela Health -> Activity shows it next to the version.

push.ps1 commits as just "vM.D.N", so there is no human note to read. A note
given with `.\\push.ps1 -Note "..."` lands in the commit body and wins over
this one (deploy.sh checks it first).

Never fails a deploy: no key, no network, a timeout or a bad answer all print
nothing and exit 0. Uses only the standard library (python3 is already on the
box for deploy.sh's planner). The key is ANTHROPIC_API_KEY from .env.local, the
same one server-v2 uses for the trigger map.
"""
import json
import os
import re
import subprocess
import sys
import urllib.request

MODEL = os.environ.get("DEPLOY_NOTE_MODEL", "claude-haiku-5-5")
URL = "https://api.anthropic.com/v1/messages"
TIMEOUT_S = 25
MAX_DIFF = 24_000
# Noise that says nothing about what changed: the version bump, lockfiles and
# the brain maps push.ps1 regenerates on every push.
EXCLUDE = [
    ":(exclude)package.json", ":(exclude)package-lock.json", ":(exclude)**/package-lock.json",
    ":(exclude)owner-vite/src/lib/brainMap.json", ":(exclude)owner-vite/src/lib/voltickMap.json",
    ":(exclude)CHANGELOG*.md", ":(exclude)CUSTOMER_CHANGELOG*.md",
]

SYSTEM = (
    "You write the one-line release note for a deploy of CB Edge, an options "
    "gamma-exposure (GEX) trading dashboard. Parts: server-v2 (the Node server "
    "and data feed), cbedge-v3 (the dashboard, and Vela, its chart app at "
    "vela.cbedge.net), owner-vite (the owner/admin site), plus small side apps. "
    "You get the commit messages, changelog lines added, the changed files and "
    "a trimmed diff. Reply with ONE plain sentence under 120 characters saying "
    "what changed, written for the site owner. Lead with the visible change. "
    "No version numbers, no file paths unless essential, no preamble, no quotes, "
    "no trailing commentary."
)


def git(*args):
    try:
        return subprocess.run(["git", *args], capture_output=True, text=True, timeout=20).stdout
    except Exception:
        return ""


def env_key():
    if os.environ.get("ANTHROPIC_API_KEY"):
        return os.environ["ANTHROPIC_API_KEY"].strip()
    try:
        with open(".env.local", encoding="utf-8") as f:
            for line in f:
                if line.startswith("ANTHROPIC_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def main():
    if len(sys.argv) < 3:
        return
    frm, to = sys.argv[1], sys.argv[2]
    if not frm or frm == to:
        return
    key = env_key()
    if not key:
        return
    rng = f"{frm}..{to}"
    messages = git("log", "--format=%s%n%b", rng).strip()
    changelog = "\n".join(
        l[1:] for l in git("diff", "--unified=0", frm, to, "--", "CHANGELOG.md", "CUSTOMER_CHANGELOG.md").splitlines()
        if l.startswith("+") and not l.startswith("+++") and l[1:].strip()
    )[:4000]
    stat = git("diff", "--stat=120", frm, to, "--", ".", *EXCLUDE)
    diff = git("diff", "--unified=1", frm, to, "--", ".", *EXCLUDE)[:MAX_DIFF]
    if not (stat.strip() or changelog.strip()):
        return
    user = (
        f"Commit messages:\n{messages or '(only version numbers)'}\n\n"
        f"Changelog lines added:\n{changelog or '(none)'}\n\n"
        f"Changed files:\n{stat}\n\nDiff (trimmed):\n{diff}"
    )
    body = json.dumps({
        "model": MODEL, "max_tokens": 120, "system": SYSTEM,
        "messages": [{"role": "user", "content": user}],
    }).encode()
    req = urllib.request.Request(URL, data=body, method="POST", headers={
        "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01",
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        out = json.load(r)
    text = " ".join(b.get("text", "") for b in out.get("content", []) if b.get("type") == "text")
    # One line, no tabs (the history log is tab-separated), no wrapping quotes.
    text = re.sub(r"\s+", " ", text).strip().strip('"').strip()
    if text:
        print(text[:200])


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
