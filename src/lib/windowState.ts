import writeFileAtomic from "write-file-atomic"
import fs from "fs-extra"
import { app, type BrowserWindow, screen, type Rectangle } from "electron"
import pathModule from "path"

export const WINDOW_STATE_VERSION = 1

export type WindowStateType = {
	width: number
	height: number
	x: number
	y: number
	fullscreen: boolean
	maximized: boolean
}

export class WindowState {
	private path: string | null = null

	private getStatePath(): string {
		if (!this.path) {
			this.path = pathModule.join(app.getPath("userData"), `windowState.v${WINDOW_STATE_VERSION}.json`)
		}

		return this.path
	}

	private stateWithinDisplayBounds(bounds: Rectangle, state: WindowStateType): boolean {
		return (
			state.x >= bounds.x &&
			state.y >= bounds.y &&
			state.x + state.width <= bounds.x + bounds.width &&
			state.y + state.height <= bounds.y + bounds.height
		)
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private validateState(state: any): boolean {
		return (
			state &&
			Number.isInteger(state.height) &&
			Number.isInteger(state.width) &&
			Number.isInteger(state.x) &&
			Number.isInteger(state.y) &&
			state.width > 0 &&
			state.height > 0
		)
	}

	private ensureWindowIsVisibleOnAnyDisplay(state: WindowStateType): boolean {
		return screen.getAllDisplays().some(display => this.stateWithinDisplayBounds(display.bounds, state))
	}

	private async reset(): Promise<void> {
		try {
			const statePath = this.getStatePath()

			await fs.unlink(statePath)
		} catch (e) {
			console.error(e)
		}
	}

	public async get(): Promise<WindowStateType | null> {
		try {
			const statePath = this.getStatePath()

			if (!(await fs.exists(statePath))) {
				return null
			}

			const state: WindowStateType = JSON.parse(await fs.readFile(statePath, "utf-8"))

			if (!this.validateState(state) || state.fullscreen || state.maximized || !this.ensureWindowIsVisibleOnAnyDisplay(state)) {
				await this.reset()

				return null
			}

			return state
		} catch (e) {
			console.error(e)

			return null
		}
	}

	private async save(state: WindowStateType): Promise<void> {
		try {
			const statePath = this.getStatePath()

			await writeFileAtomic(statePath, JSON.stringify(state))
		} catch (e) {
			console.error(e)
		}
	}

	private async handleWindowStateUpdate(window: BrowserWindow): Promise<void> {
		try {
			const bounds = window.getBounds()
			const state: WindowStateType = {
				width: bounds.width,
				height: bounds.height,
				x: bounds.x,
				y: bounds.y,
				fullscreen: window.isFullScreen(),
				maximized: window.isMaximized()
			}

			await this.save(state)
		} catch (e) {
			console.error(e)
		}
	}

	public manage(window: BrowserWindow): void {
		const listener = () => {
			this.handleWindowStateUpdate(window).catch(console.error)
		}

		const cleaner = () => {
			window.removeListener("moved", listener)
			window.removeListener("resized", listener)
			window.removeListener("maximize", listener)
			window.removeListener("unmaximize", listener)
			window.removeListener("enter-full-screen", listener)
			window.removeListener("enter-html-full-screen", listener)
			window.removeListener("leave-full-screen", listener)
			window.removeListener("leave-html-full-screen", listener)
		}

		window.addListener("moved", listener)
		window.addListener("resized", listener)
		window.addListener("maximize", listener)
		window.addListener("unmaximize", listener)
		window.addListener("enter-full-screen", listener)
		window.addListener("enter-html-full-screen", listener)
		window.addListener("leave-full-screen", listener)
		window.addListener("leave-html-full-screen", listener)

		window.once("close", cleaner)
		window.once("closed", cleaner)
	}
}

export default WindowState
