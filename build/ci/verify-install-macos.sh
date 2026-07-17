#!/usr/bin/env bash
# Install-check for the macOS artifacts.
#
# For both the dmg and the zip (the auto-update payload) of the given arch:
#   - deep strict codesign verification
#   - Gatekeeper assessment (spctl) - validates signing + notarization end to end
#   - the designated-requirement check Squirrel.Mac performs when deployed clients stage an
#     update: identifier io.filen.desktop + Filen's Team ID. If this fails, every existing
#     install silently stops auto-updating.
#   - executable arch and bundle version match expectations
#   - latest-mac.yml sizes/hashes match the artifacts and carry minimumSystemVersion
#
# Usage: verify-install-macos.sh x64|arm64   (artifacts expected in ./prod)

set -euo pipefail

ARCH="$1"
LIPO_ARCH="$([ "$ARCH" = "x64" ] && echo "x86_64" || echo "arm64")"
EXPECTED_VERSION="$(node -p "require('./package.json').version")"
DR='identifier "io.filen.desktop" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] and certificate leaf[field.1.2.840.113635.100.6.1.13] and certificate leaf[subject.OU] = "7YTW5D2K7P"'
WORK="$(mktemp -d /tmp/filen-verify.XXXXXX)"

cleanup() {
	hdiutil detach "$WORK/dmg-mount" >/dev/null 2>&1 || true
	rm -rf "$WORK"
}
trap cleanup EXIT

assert_app() {
	local app="$1" source="$2"

	codesign --verify --deep --strict "$app" || {
		echo "FAIL [$source]: deep codesign verification failed"
		exit 1
	}

	spctl --assess --type execute "$app" || {
		echo "FAIL [$source]: Gatekeeper assessment failed (signing/notarization)"
		exit 1
	}

	codesign --verify -R="$DR" "$app" || {
		echo "FAIL [$source]: does not satisfy the installed base's designated requirement - deployed clients would reject this update"
		exit 1
	}

	local archs
	archs="$(lipo -archs "$app/Contents/MacOS/Filen")"
	[ "$archs" = "$LIPO_ARCH" ] || {
		echo "FAIL [$source]: binary arch is '$archs', expected '$LIPO_ARCH'"
		exit 1
	}

	local version
	version="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$app/Contents/Info.plist")"
	[ "$version" = "$EXPECTED_VERSION" ] || {
		echo "FAIL [$source]: bundle version is $version, expected $EXPECTED_VERSION"
		exit 1
	}

	[ -f "$app/Contents/Resources/app-update.yml" ] || {
		echo "FAIL [$source]: Resources/app-update.yml missing - the installed app could never auto-update"
		exit 1
	}

	echo "OK [$source]: $LIPO_ARCH v$version, codesign + Gatekeeper + designated requirement pass"
}

# 1. Feed manifest sanity (deployed clients trust latest-mac.yml blindly; minimumSystemVersion
#    keeps Big Sur clients off Electron 43+ builds).
python3 build/ci/check-feed.py prod/latest-mac.yml prod --require-minimum-system-version

# 2. The zip - this exact archive is what Squirrel.Mac stages during auto-update.
ditto -x -k "prod/Filen_mac_${ARCH}.zip" "$WORK/zip"
assert_app "$WORK/zip/Filen.app" "Filen_mac_${ARCH}.zip"

# 3. The dmg - the website download.
hdiutil attach -nobrowse -readonly -mountpoint "$WORK/dmg-mount" "prod/Filen_mac_${ARCH}.dmg" >/dev/null
ditto "$WORK/dmg-mount/Filen.app" "$WORK/dmg-app/Filen.app"
hdiutil detach "$WORK/dmg-mount" >/dev/null
assert_app "$WORK/dmg-app/Filen.app" "Filen_mac_${ARCH}.dmg"

echo "verify-install-macos PASSED for $ARCH"
