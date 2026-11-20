import { exec, spawn } from 'node:child_process'

/**
 * Find all descendants of a process (posix only).
 * The full process table is collected first and then walked, so it doesn't rely on `ps` listing parents before their children
 * (which is not true once pids have wrapped around).
 */
async function getChildPids(pid: number): Promise<number[]> {
	return new Promise((resolve, reject) => {
		const proc = spawn('ps', ['-A', '-o', 'ppid=,pid='], {
			signal: AbortSignal.timeout(10000), // Ensure it doesn't hang indefinitely if something goes wrong
		})
		let output = ''
		let failed = false
		proc.stdout.on('data', (d) => (output += d))
		proc.on('error', (err) => {
			failed = true
			reject(err)
		})
		proc.on('close', () => {
			if (failed) return

			const childrenByParent = new Map<number, number[]>()
			for (const line of output.trim().split('\n')) {
				const parts = line.trim().split(/\s+/)
				if (parts.length < 2) continue
				const ppid = parseInt(parts[0], 10)
				const cpid = parseInt(parts[1], 10)
				if (isNaN(ppid) || isNaN(cpid)) continue

				const siblings = childrenByParent.get(ppid)
				if (siblings) siblings.push(cpid)
				else childrenByParent.set(ppid, [cpid])
			}

			const descendants: number[] = []
			const seen = new Set([pid])
			const queue = [pid]
			for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
				for (const cpid of childrenByParent.get(next) ?? []) {
					if (seen.has(cpid)) continue
					seen.add(cpid)
					descendants.push(cpid)
					queue.push(cpid)
				}
			}
			resolve(descendants)
		})
	})
}

export function kill(pid: number, sig = 'SIGTERM'): void {
	if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
		throw new Error('Invalid PID: ' + pid)
	}

	if (process.platform === 'win32') {
		// taskkill handles the process tree itself (/T). It is always forceful (/F), as windows has no equivalent of SIGTERM
		exec(`taskkill /pid ${pid} /T /F`, (err) => {
			if (err) console.warn(`taskkill failed for PID ${pid}:`, err.message)
		})
		return
	}

	getChildPids(pid)
		.then((children) => {
			for (const p of [...children, pid]) {
				try {
					process.kill(p, sig)
				} catch (_) {
					// process already gone
				}
			}
		})
		.catch(() => {
			// If we fail to get child PIDs, at least try to kill the main process
			try {
				process.kill(pid, sig)
			} catch (_) {
				// process already gone
			}

			console.warn(`Failed to get child processes of PID ${pid}, some child processes may not have been killed`)
		})
}
