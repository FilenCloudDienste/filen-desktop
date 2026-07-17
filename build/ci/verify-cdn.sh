#!/usr/bin/env bash
# Post-publish check: the CDN feed deployed clients actually poll must byte-match the release.
#
# Everything else in the verify suite validates the BUILT artifacts; clients never see those - they
# poll https://cdn.filen.io/@filen/desktop/release/latest/. A stale, partial, or missing manifest
# there (e.g. a sync process with a hardcoded file list that predates latest-linux-arm64.yml)
# silently strands an entire cohort while every build-side check stays green. This closes that gap:
# each manifest on the CDN must equal the release asset, and every files[] url it lists must be
# HEAD-able on the CDN with the size the manifest promises.
#
# The release->CDN sync starts when the build workflow succeeds and this check starts at the same
# moment (workflow_run trigger), so it retries for up to ~30 minutes while the sync runs.
#
# Usage: verify-cdn.sh [release-tag]   (requires gh + GH_TOKEN; defaults to the latest release,
# which is what the CDN's /release/latest/ path mirrors)

set -euo pipefail

TAG="${1:-}"
CDN_BASE="https://cdn.filen.io/@filen/desktop/release/latest"
MANIFESTS=(latest.yml latest-mac.yml latest-linux.yml latest-linux-arm64.yml)
WORK="$(mktemp -d /tmp/filen-cdn.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

if [ -n "$TAG" ]; then
	gh release download "$TAG" --pattern "latest*.yml" --dir "$WORK/release"
else
	TAG="$(gh release view --json tagName --jq .tagName)"
	echo "Comparing CDN against the latest release: $TAG"
	gh release download "$TAG" --pattern "latest*.yml" --dir "$WORK/release"
fi

for manifest in "${MANIFESTS[@]}"; do
	[ -f "$WORK/release/$manifest" ] || {
		echo "FAIL: $manifest is not attached to release $TAG"
		exit 1
	}
done

for manifest in "${MANIFESTS[@]}"; do
	matched=""

	for attempt in $(seq 1 30); do
		if curl -sf --max-time 30 "$CDN_BASE/$manifest" -o "$WORK/cdn-$manifest" && cmp -s "$WORK/release/$manifest" "$WORK/cdn-$manifest"; then
			matched=1
			break
		fi

		echo "$manifest: CDN does not match the release yet (attempt $attempt/30), waiting 60s for the sync..."
		sleep 60
	done

	[ -n "$matched" ] || {
		echo "FAIL: $CDN_BASE/$manifest never matched the release asset - deployed clients are being served a stale or missing manifest"
		diff <(head -5 "$WORK/release/$manifest") <(head -5 "$WORK/cdn-$manifest" 2>/dev/null || echo "<unfetchable>") || true
		exit 1
	}

	echo "OK: $manifest on the CDN matches the release"

	# Every artifact the manifest points at must be fetchable from the CDN at the promised size.
	while IFS=$'\t' read -r url size; do
		length="$(curl -sfI --max-time 30 "$CDN_BASE/$url" | tr -d '\r' | awk 'tolower($1) == "content-length:" { print $2 }' | tail -1)"

		[ -n "$length" ] || {
			echo "FAIL: $CDN_BASE/$url is not fetchable but $manifest points clients at it"
			exit 1
		}

		[ "$length" = "$size" ] || {
			echo "FAIL: $CDN_BASE/$url is $length bytes, manifest promises $size - clients will fail hash verification"
			exit 1
		}

		echo "OK: $url on the CDN ($length bytes)"
	done < <(awk '/^ *- url: /{u=$3} /^ *size: /{print u "\t" $2}' "$WORK/release/$manifest")
done

echo "verify-cdn PASSED for $TAG"
