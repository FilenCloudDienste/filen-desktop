#!/usr/bin/env python3
# Verify an electron-updater feed manifest (latest*.yml) against the built artifacts.
# Deployed clients trust this manifest blindly: a wrong hash/size bricks their download
# verification, a missing entry silently strands a whole install-format cohort, and a
# wrong minimumSystemVersion value either bricks old machines or strands everyone
# (electron-updater fails OPEN on an unparseable value).
#
# Usage:
#   check-feed.py <manifest.yml> <artifacts-dir>
#       [--expect NAME]...            files[] urls must EQUAL this set exactly
#       [--first-url NAME]            files[0].url contract (legacy clients take the first entry)
#       [--expect-version X]          top-level version must equal X
#       [--minimum-system-version X]  top-level minimumSystemVersion must equal X exactly
#       [--forbid SUBSTRING]...       no files[].url may contain SUBSTRING (cross-arch contamination)
#       [--require-admin-rights]      every .exe entry must carry isAdminRightsRequired: true

import argparse
import base64
import hashlib
import os
import re
import sys

parser = argparse.ArgumentParser()
parser.add_argument("manifest")
parser.add_argument("artifacts_dir")
parser.add_argument("--expect", action="append", default=[])
parser.add_argument("--first-url")
parser.add_argument("--expect-version")
parser.add_argument("--minimum-system-version")
parser.add_argument("--forbid", action="append", default=[])
parser.add_argument("--require-admin-rights", action="store_true")
args = parser.parse_args()

with open(args.manifest, "r", encoding="utf-8") as f:
    text = f.read()

# Order-coupled to electron-builder / build/hashes.ts output (url -> sha512 -> size). A serializer
# change makes this parse ZERO entries, which fails loudly below - never silently passes.
entries = re.findall(r"-\s+url:\s+(\S+)\s*\n\s+sha512:\s+(\S+)\s*\n\s+size:\s+(\d+)", text)

if not entries:
    sys.exit(f"check-feed: no file entries parsed from {args.manifest}")

errors = []

for name, expected_sha, expected_size in entries:
    path = os.path.join(args.artifacts_dir, name)

    if not os.path.isfile(path):
        errors.append(f"{name} is listed in {args.manifest} but missing from {args.artifacts_dir}")
        continue

    size = os.path.getsize(path)

    if size != int(expected_size):
        errors.append(f"{name} size mismatch (manifest {expected_size}, actual {size})")

    sha = hashlib.sha512()

    with open(path, "rb") as binary:
        for chunk in iter(lambda: binary.read(1024 * 1024), b""):
            sha.update(chunk)

    digest = base64.b64encode(sha.digest()).decode()

    if digest != expected_sha:
        errors.append(f"{name} sha512 mismatch (manifest {expected_sha}, actual {digest})")

    if size == int(expected_size) and digest == expected_sha:
        print(f"check-feed OK: {name} ({size} bytes)")

urls = [name for name, _, _ in entries]

if args.expect:
    if set(urls) != set(args.expect):
        errors.append(f"files[] set mismatch: manifest has {sorted(urls)}, expected {sorted(args.expect)}")
    else:
        print(f"check-feed OK: files[] set matches ({len(urls)} entries)")

if args.first_url:
    if urls[0] != args.first_url:
        errors.append(f"files[0].url is {urls[0]}, expected {args.first_url} (legacy clients download the first entry)")
    else:
        print(f"check-feed OK: files[0].url == {args.first_url}")

for substring in args.forbid:
    offenders = [u for u in urls if substring in u]
    if offenders:
        errors.append(f"cross-arch contamination: {offenders} contain forbidden '{substring}'")

if args.expect_version:
    m = re.search(r"^version:\s*(\S+)", text, re.M)
    if not m or m.group(1) != args.expect_version:
        errors.append(f"manifest version is {m.group(1) if m else 'MISSING'}, expected {args.expect_version}")
    else:
        print(f"check-feed OK: version == {args.expect_version}")

if args.minimum_system_version:
    m = re.search(r"^minimumSystemVersion:\s*(\S+)", text, re.M)
    if not m:
        errors.append(f"{args.manifest} is missing minimumSystemVersion (old-OS clients would be offered an update that cannot launch)")
    elif m.group(1) != args.minimum_system_version:
        errors.append(f"minimumSystemVersion is {m.group(1)}, expected {args.minimum_system_version} (electron-updater compares it against os.release() and FAILS OPEN on a bad value)")
    else:
        print(f"check-feed OK: minimumSystemVersion == {args.minimum_system_version}")

if args.require_admin_rights:
    exe_count = sum(1 for u in urls if u.endswith(".exe"))
    admin_count = len(re.findall(r"^\s+isAdminRightsRequired:\s*true", text, re.M))
    if admin_count < exe_count:
        errors.append(f"only {admin_count}/{exe_count} exe entries carry isAdminRightsRequired: true")
    else:
        print("check-feed OK: isAdminRightsRequired present on all exe entries")

if errors:
    for error in errors:
        print(f"check-feed FAIL: {error}", file=sys.stderr)

    sys.exit(1)

print(f"check-feed PASSED for {args.manifest}")
