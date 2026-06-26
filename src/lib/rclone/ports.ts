import net from "net"

/**
 * A fixed list of high (ephemeral-range) ports to try when picking a free loopback port for rclone rc ports / serve ports.
 * Spread across 49152-51200. Ported from the old @filen/network-drive port picker.
 *
 * @type {number[]}
 */
export const POSSIBLE_PORTS: number[] = [
	49152, 49162, 49172, 49182, 49192, 49202, 49212, 49222, 49232, 49242, 49252, 49262, 49272, 49282, 49292, 49302, 49312, 49322, 49332,
	49342, 49352, 49362, 49372, 49382, 49392, 49402, 49412, 49422, 49432, 49442, 49452, 49462, 49472, 49482, 49492, 49502, 49512, 49522,
	49532, 49542, 49552, 49562, 49572, 49582, 49592, 49602, 49612, 49622, 49632, 49642, 49652, 49662, 49672, 49682, 49692, 49702, 49712,
	49722, 49732, 49742, 49752, 49762, 49772, 49782, 49792, 49802, 49812, 49822, 49832, 49842, 49852, 49862, 49872, 49882, 49892, 49902,
	49912, 49922, 49932, 49942, 49952, 49962, 49972, 49982, 49992, 50002, 50010, 50020, 50030, 50040, 50050, 50060, 50070, 50080, 50090,
	50100, 50110, 50120, 50130, 50140, 50150, 50160, 50170, 50180, 50190, 50200, 50210, 50220, 50230, 50240, 50250, 50260, 50270, 50280,
	50290, 50300, 50310, 50320, 50330, 50340, 50350, 50360, 50370, 50380, 50390, 50400, 50410, 50420, 50430, 50440, 50450, 50460, 50470,
	50480, 50490, 50500, 50510, 50520, 50530, 50540, 50550, 50560, 50570, 50580, 50590, 50600, 50610, 50620, 50630, 50640, 50650, 50660,
	50670, 50680, 50690, 50700, 50710, 50720, 50730, 50740, 50750, 50760, 50770, 50780, 50790, 50800, 50810, 50820, 50830, 50840, 50850,
	50860, 50870, 50880, 50890, 50900, 50910, 50920, 50930, 50940, 50950, 50960, 50970, 50980, 50990, 51000, 51010, 51020, 51030, 51040,
	51050, 51060, 51070, 51080, 51090, 51100, 51110, 51120, 51130, 51140, 51150, 51160, 51170, 51180, 51190, 51200
]

/**
 * Resolves true iff a server can bind the given port on 127.0.0.1 and then close cleanly; resolves false on any error.
 *
 * @export
 * @async
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export async function isPortFree(port: number): Promise<boolean> {
	return new Promise<boolean>(resolve => {
		const server = net.createServer()

		server.once("error", () => {
			resolve(false)
		})

		server.once("listening", () => {
			server.close(err => {
				resolve(err ? false : true)
			})
		})

		server.listen(port, "127.0.0.1")
	})
}

/**
 * Iterate POSSIBLE_PORTS and return the first free loopback port, or null if none are free.
 *
 * Note: there is an inherent TOCTOU (time-of-check to time-of-use) race - a returned port can be taken by another process
 * before the caller binds it, so callers must still handle a later bind failure.
 *
 * @export
 * @async
 * @returns {Promise<number | null>}
 */
export async function findFreePort(): Promise<number | null> {
	for (const port of POSSIBLE_PORTS) {
		const isFree = await isPortFree(port)

		if (isFree) {
			return port
		}
	}

	return null
}
