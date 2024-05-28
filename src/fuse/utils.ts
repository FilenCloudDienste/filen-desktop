import crypto from "crypto"
import memoize from "lodash/memoize"
import type { OpenMode } from "./types"

export const uuidToNumber = memoize((uuid: string): number => {
	uuid = uuid.split("-").join("").trim()

	let hash = 0

	for (let i = 0; i < uuid.length; i++) {
		const character = uuid.charCodeAt(i)

		hash += character
	}

	return hash
})

export const flagsToMode = (flags: number): OpenMode => {
	flags = flags & 3

	if (flags === 0) {
		return "r"
	}

	if (flags === 1) {
		return "w"
	}

	return "r+"
}

export const pathToHash = memoize((path: string): string => {
	return crypto.createHash("sha256").update(path).digest("hex")
})
