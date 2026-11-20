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

/**
 * Send a signal to a process and all of its descendants.
 * Resolves with every pid which was signalled (including `pid` itself), so that the caller can check on them later. This
 * matters as descendants which outlive their parent get reparented, and can no longer be found by walking the tree.
 *
 * On windows the whole tree is always forcefully terminated with `taskkill /T /F`, whatever the signal, as there is no
 * equivalent of SIGTERM. The result is then just `[pid]`.
 */
export async function killProcessTree(pid: number, sig: NodeJS.Signals = 'SIGTERM'): Promise<number[]> {
	if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
		throw new Error('Invalid PID: ' + pid)
	}

	if (process.platform === 'win32') {
		await new Promise<void>((resolve) => {
			exec(`taskkill /pid ${pid} /T /F`, (err) => {
				if (err) console.warn(`taskkill failed for PID ${pid}:`, err.message)
				resolve()
			})
		})
		return [pid]
	}

	let children: number[] = []
	try {
		children = await getChildPids(pid)
	} catch (_e) {
		// If we fail to get child PIDs, at least try to kill the main process
		console.warn(`Failed to get child processes of PID ${pid}, some child processes may not have been killed`)
	}

	const pids = [...children, pid]
	for (const p of pids) {
		try {
			process.kill(p, sig)
		} catch (_) {
			// process already gone
		}
	}
	return pids
}

/**
 * Check whether a process is still running.
 * A process owned by another user is reported as not alive, as it can't be ours (the pid must have been reused) and
 * couldn't be signalled anyway.
 */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (_e) {
		return false
	}
}
