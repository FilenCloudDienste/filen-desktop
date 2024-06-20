export type State = {
	webdavStarted: boolean
	fuseStarted: boolean
	s3Started: boolean
	syncStarted: boolean
}

export let STATE: State = {
	webdavStarted: false,
	fuseStarted: false,
	s3Started: false,
	syncStarted: false
}

export function setState(fn: ((state: State) => State) | State): void {
	STATE = typeof fn === "function" ? fn(STATE) : fn
}

export function getState(): State {
	return STATE
}

export default STATE
