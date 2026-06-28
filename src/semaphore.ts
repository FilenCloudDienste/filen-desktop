export interface ISemaphore {
	acquire(): Promise<void>
	release(): void
	count(): number
	setMax(newMax: number): void
	purge(): number
}

/**
 * Basic Semaphore implementation.
 * @date 2/15/2024 - 4:52:51 AM
 *
 * @type {new (max: number) => ISemaphore}
 */
export const Semaphore = function (this: ISemaphore, max: number) {
	let counter = 0
	// FIFO queue of pending acquirers, consumed from `head` instead of with Array.shift(). shift() is O(n)
	// (it re-indexes the whole array), so a large fan-out queued ~N waiters and each of the N releases
	// shifted an ~N-length array — O(N²). The head pointer makes each dequeue O(1) amortized; the consumed
	// prefix is compacted occasionally so a long-lived semaphore never retains an unbounded backing array.
	let waiting: ({ resolve: (value: void | PromiseLike<void>) => void; err: (reason?: unknown) => void } | undefined)[] = []
	let head = 0
	let maxCount = max || 1

	const take = function (): void {
		if (head < waiting.length && counter < maxCount) {
			counter++

			const promise = waiting[head]

			waiting[head] = undefined
			head++

			if (head >= 1024 && head * 2 >= waiting.length) {
				waiting = waiting.slice(head)
				head = 0
			}

			if (!promise) {
				return
			}

			promise.resolve()
		}
	}

	this.acquire = function (): Promise<void> {
		if (counter < maxCount) {
			counter++

			return new Promise<void>(resolve => {
				resolve()
			})
		} else {
			return new Promise<void>((resolve, err) => {
				waiting.push({
					resolve: resolve,
					err: err
				})
			})
		}
	}

	this.release = function (): void {
		counter--

		take()
	}

	this.count = function (): number {
		return counter
	}

	this.setMax = function (newMax: number): void {
		maxCount = newMax
	}

	this.purge = function (): number {
		const unresolved = waiting.length - head

		for (let i = head; i < waiting.length; i++) {
			const w = waiting[i]

			if (!w) {
				continue
			}

			w.err("Task has been purged")
		}

		counter = 0
		waiting = []
		head = 0

		return unresolved
	}
} as unknown as { new (max: number): ISemaphore }
