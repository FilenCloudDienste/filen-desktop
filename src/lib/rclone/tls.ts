import net from "net"
import crypto from "crypto"
import pathModule from "path"
import fs from "fs-extra"
import selfsigned from "selfsigned"
import writeFileAtomic from "write-file-atomic"

/**
 * A single subjectAltName entry in the node-forge / selfsigned shape: an iPAddress SAN (`type: 7`, `ip` field)
 * or a dNSName SAN (`type: 2`, `value` field). The numeric `type` values are X.509 GeneralName tags.
 */
export type CertAltName = { type: 7; ip: string } | { type: 2; value: string }

/**
 * Build the subjectAltName entries covering `hostname`, in the node-forge / selfsigned shape (spec §9).
 *
 * SAN type is load-bearing: a TLS client matches the connection target against subjectAltName only (CN is
 * ignored by Go/rclone, Chromium, macOS). An IP target matches an `iPAddress` SAN (`type: 7`, `ip`); a DNS
 * target matches a `dNSName` SAN (`type: 2`, `value`). Putting an IP into a dNSName makes clients reject the
 * cert ("certificate is valid for …, not 192.168.0.1").
 *
 * Loopback (`127.0.0.1`, `::1`, `localhost`) is always included so the cert survives for the loopback case no
 * matter what the user set. A user IP host is added as an iPAddress (skipping the bind-all `0.0.0.0`/`::`); a
 * user DNS host is added as a dNSName. The IP-vs-DNS decision is made with `net.isIP()`.
 *
 * @export
 * @param {string} hostname
 * @returns {CertAltName[]}
 */
export function buildAltNames(hostname: string): CertAltName[] {
	const ips = new Set<string>(["127.0.0.1", "::1"])
	const dns = new Set<string>(["localhost"])
	const h = (hostname ?? "").trim()
	const family = net.isIP(h)

	if (family !== 0) {
		if (h !== "0.0.0.0" && h !== "::") {
			ips.add(h)
		}
	} else if (h.length > 0 && h !== "localhost") {
		dns.add(h)
	}

	return [...[...ips].map((ip): CertAltName => ({ type: 7, ip })), ...[...dns].map((value): CertAltName => ({ type: 2, value }))]
}

/**
 * Generate a fresh self-signed leaf TLS cert + key (PEM) for `hostname`.
 *
 * RSA-2048 / SHA-256, valid 397 days (the CA/Browser-forum maximum for leaf certs). The cert is a leaf
 * (`basicConstraints cA:false`) with `keyUsage` digitalSignature+keyEncipherment and `extKeyUsage` serverAuth,
 * so modern clients accept it for TLS server authentication. The subjectAltName is built by
 * {@link buildAltNames} (IP-vs-DNS handled per spec §9). CN falls back to `localhost` for an empty or bind-all
 * (`0.0.0.0`/`::`) hostname since CN is cosmetic but should not be blank.
 *
 * @export
 * @param {string} hostname
 * @returns {{ cert: string; key: string }}
 */
export function generateServerCert(hostname: string): { cert: string; key: string } {
	const h = (hostname ?? "").trim()
	const commonName = h.length === 0 || h === "0.0.0.0" || h === "::" ? "localhost" : h
	const pems = selfsigned.generate([{ name: "commonName", value: commonName }], {
		keySize: 2048,
		algorithm: "sha256",
		days: 397,
		extensions: [
			{
				name: "basicConstraints",
				cA: false
			},
			{
				name: "keyUsage",
				digitalSignature: true,
				keyEncipherment: true
			},
			{
				name: "extKeyUsage",
				serverAuth: true
			},
			{
				name: "subjectAltName",
				altNames: buildAltNames(hostname)
			}
		]
	})

	return {
		cert: pems.cert,
		key: pems.private
	}
}

/**
 * Expand an IPv6 address to its fully-uncompressed lowercase 8-group form so the differing textual renderings
 * of one address compare equal — e.g. `::1` and OpenSSL's `0:0:0:0:0:0:0:1`, or `fe80::1` and the uppercase
 * `FE80:0:0:0:0:0:0:1` that `crypto.X509Certificate.subjectAltName` emits. IPv4 is returned unchanged; any
 * non-IP string is lowercased so callers can compare defensively.
 *
 * @param {string} ip
 * @returns {string}
 */
function normalizeIpForCompare(ip: string): string {
	const value = ip.trim()
	const family = net.isIP(value)

	if (family === 4) {
		return value
	}

	if (family !== 6) {
		return value.toLowerCase()
	}

	const address = value.split("%")[0] ?? value
	const [head, tail] = address.split("::")
	const headGroups = head && head.length > 0 ? head.split(":") : []
	const tailGroups = tail !== undefined && tail.length > 0 ? tail.split(":") : []
	const missing = 8 - (headGroups.length + tailGroups.length)
	const middleGroups = missing > 0 ? new Array<string>(missing).fill("0") : []

	return [...headGroups, ...middleGroups, ...tailGroups].map(group => parseInt(group, 16).toString(16)).join(":")
}

/**
 * Return true iff the cert's subjectAltName already covers `hostname` with the correct SAN type.
 *
 * Clients match the connection target against SANs only, so an IP host must appear as an `IP Address:` SAN and
 * a DNS host as a `DNS:` SAN — a name in the wrong slot does not count. The SAN list is read from
 * `crypto.X509Certificate.subjectAltName` (a comma-separated string like `IP Address:127.0.0.1, DNS:localhost`).
 * IP comparison runs on a normalized form (see {@link normalizeIpForCompare}) so `::1` matches OpenSSL's
 * `0:0:0:0:0:0:0:1` and case/compression differences never cause a false miss. An empty hostname, an absent
 * SAN, or any parse failure returns false.
 *
 * @export
 * @param {string} certPem
 * @param {string} hostname
 * @returns {boolean}
 */
export function certCoversHostname(certPem: string, hostname: string): boolean {
	try {
		const h = (hostname ?? "").trim()

		if (h.length === 0) {
			return false
		}

		const certificate = new crypto.X509Certificate(certPem)
		const san = certificate.subjectAltName

		if (!san) {
			return false
		}

		const entries = san.split(",").map(entry => entry.trim())

		if (net.isIP(h) !== 0) {
			const target = normalizeIpForCompare(h)

			return entries.some(
				entry => entry.startsWith("IP Address:") && normalizeIpForCompare(entry.slice("IP Address:".length)) === target
			)
		}

		const target = h.toLowerCase()

		return entries.some(entry => entry.startsWith("DNS:") && entry.slice("DNS:".length).trim().toLowerCase() === target)
	} catch {
		return false
	}
}

/**
 * True iff the cert is already expired or expires within `days` days — used to renew before the cert lapses.
 * A cert whose `validTo` cannot be parsed is treated as expiring (renew).
 *
 * @param {string} certPem
 * @param {number} days
 * @returns {boolean}
 */
function certExpiresWithinDays(certPem: string, days: number): boolean {
	try {
		const validTo = new Date(new crypto.X509Certificate(certPem).validTo).getTime()

		if (Number.isNaN(validTo)) {
			return true
		}

		return validTo - Date.now() <= days * 24 * 60 * 60 * 1000
	} catch {
		return true
	}
}

/**
 * Ensure a usable cert/key pair exists at `certPath`/`keyPath` for `hostname`, generating and persisting one
 * if needed, and return the PEM strings.
 *
 * The existing pair is reused only when both files exist, the cert already covers `hostname` (see
 * {@link certCoversHostname}) and it is not within ~30 days of expiry; otherwise a fresh pair is generated
 * (see {@link generateServerCert}). Parent directories are created as needed and both files are written
 * atomically — the key with mode `0o600` since it is secret. Any problem reading/parsing the existing pair
 * falls through to regeneration.
 *
 * @export
 * @async
 * @param {string} certPath
 * @param {string} keyPath
 * @param {string} hostname
 * @returns {Promise<{ cert: string; key: string }>}
 */
export async function ensureServerCert(certPath: string, keyPath: string, hostname: string): Promise<{ cert: string; key: string }> {
	try {
		const [certExists, keyExists] = await Promise.all([fs.pathExists(certPath), fs.pathExists(keyPath)])

		if (certExists && keyExists) {
			const [existingCert, existingKey] = await Promise.all([fs.readFile(certPath, "utf8"), fs.readFile(keyPath, "utf8")])

			if (certCoversHostname(existingCert, hostname) && !certExpiresWithinDays(existingCert, 30)) {
				return {
					cert: existingCert,
					key: existingKey
				}
			}
		}
	} catch {
		// Fall through and regenerate on any read/parse problem.
	}

	const generated = generateServerCert(hostname)

	await Promise.all([fs.ensureDir(pathModule.dirname(certPath)), fs.ensureDir(pathModule.dirname(keyPath))])

	await writeFileAtomic(certPath, generated.cert)
	await writeFileAtomic(keyPath, generated.key, {
		mode: 0o600
	})

	return generated
}
