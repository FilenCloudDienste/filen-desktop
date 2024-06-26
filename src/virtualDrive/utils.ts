import { exec } from "child_process"
import os from "os"

export async function execCommand(command: string, trimStdOut: boolean = true): Promise<string> {
	return new Promise((resolve, reject) => {
		exec(command, (err, stdout, stderr) => {
			if (err || stderr) {
				reject(err ? err : new Error(stderr))

				return
			}

			resolve(trimStdOut ? stdout.trim() : stdout)
		})
	})
}

export async function killProcessByName(processName: string): Promise<void> {
	await execCommand(os.platform() === "win32" ? `taskkill /F /T /IM ${processName}` : `pkill -TERM -P $(pgrep -d',' -f ${processName})`)
}
