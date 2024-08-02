import electron from "electron"

// https://github.com/sindresorhus/electron-is-dev/blob/main/index.js

const { env } = process
const isEnvSet = "ELECTRON_IS_DEV" in env
const getFromEnv = Number.parseInt(env.ELECTRON_IS_DEV ?? "0", 10) === 1

export const isDev = typeof electron === "string" ? true : isEnvSet ? getFromEnv : !electron.app.isPackaged

export default isDev
