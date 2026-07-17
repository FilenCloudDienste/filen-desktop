#!/usr/bin/env python3
# Verify an electron-updater feed manifest (latest*.yml) against the built artifacts:
# every listed file must exist, and its size and base64 sha512 must match what the
# manifest promises - a mismatch bricks auto-update for every deployed client.
#
# Usage: check-feed.py <manifest.yml> <artifacts-dir> [--require-minimum-system-version]
#
# --require-minimum-system-version asserts the top-level minimumSystemVersion key that
# build/inject-min-darwin.js adds to latest-mac.yml (gates Big Sur clients off Electron 43+).

import base64
import hashlib
import os
import re
import sys

yml_path, artifacts_dir = sys.argv[1], sys.argv[2]
require_msv = "--require-minimum-system-version" in sys.argv[3:]

with open(yml_path, "r", encoding="utf-8") as f:
    text = f.read()

entries = re.findall(r"-\s+url:\s+(\S+)\s*\n\s+sha512:\s+(\S+)\s*\n\s+size:\s+(\d+)", text)

if not entries:
    sys.exit(f"check-feed: no file entries parsed from {yml_path}")

for name, expected_sha, expected_size in entries:
    path = os.path.join(artifacts_dir, name)

    if not os.path.isfile(path):
        sys.exit(f"check-feed: {name} is listed in {yml_path} but missing from {artifacts_dir}")

    size = os.path.getsize(path)

    if size != int(expected_size):
        sys.exit(f"check-feed: {name} size mismatch (manifest {expected_size}, actual {size})")

    sha = hashlib.sha512()

    with open(path, "rb") as binary:
        for chunk in iter(lambda: binary.read(1024 * 1024), b""):
            sha.update(chunk)

    digest = base64.b64encode(sha.digest()).decode()

    if digest != expected_sha:
        sys.exit(f"check-feed: {name} sha512 mismatch (manifest {expected_sha}, actual {digest})")

    print(f"check-feed OK: {name} ({size} bytes)")

if require_msv:
    if not re.search(r"^minimumSystemVersion:", text, re.M):
        sys.exit(f"check-feed: {yml_path} is missing minimumSystemVersion (Big Sur clients would be offered an update that cannot launch)")

    print("check-feed OK: minimumSystemVersion present")

print(f"check-feed PASSED for {yml_path}")
