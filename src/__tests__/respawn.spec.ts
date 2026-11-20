import { afterEach, describe, expect, it } from 'vitest'
import { once } from 'node:events'
import { RespawnWorkerMonitor } from '../respawn-worker.js'
import { RespawnMonitor } from '../respawn-process.js'
import type { RespawnMonitorBase } from '../respawn-base.js'

const monitors: RespawnMonitorBase<any, any>[] = []
afterEach(async () => {
	await Promise.all(monitors.splice(0).map(async (m) => new Promise<void>((resolve) => m.stop(resolve))))
})

function track<T extends RespawnMonitorBase<any, any>>(monitor: T): T {
	monitors.push(monitor)
	return monitor
}

function recordEvents(monitor: RespawnMonitorBase<any, any>): string[] {
	const events: string[] = []
	for (const name of ['start', 'spawn', 'exit', 'sleep', 'crash', 'stop', 'warn']) {
		monitor.on(name, () => events.push(name))
	}
	return events
}

describe('RespawnWorkerMonitor', () => {
	it('respawns a worker which throws an uncaught exception, until maxRestarts is reached', async () => {
		const monitor = track(
			new RespawnWorkerMonitor('throw new Error("boom")', { eval: true, sleep: 10, maxRestarts: 2 })
		)
		const events = recordEvents(monitor)
		const warnings: Error[] = []
		monitor.on('warn', (err) => warnings.push(err))

		monitor.start()
		await once(monitor, 'crash')

		expect(events.filter((e) => e === 'spawn')).toHaveLength(3) // initial + 2 restarts
		expect(warnings.map((e) => e.message)).toEqual(['boom', 'boom', 'boom'])
		expect(monitor.status).toBe('crashed')
	})

	it('respawns a worker which exits', async () => {
		const monitor = track(new RespawnWorkerMonitor('process.exit(3)', { eval: true, sleep: 10, maxRestarts: 1 }))
		const exitCodes: Array<number | null> = []
		monitor.on('exit', (code) => exitCodes.push(code))

		monitor.start()
		await once(monitor, 'crash')

		expect(exitCodes).toEqual([3, 3])
	})

	it('treats a worker which cannot be constructed as a crash, rather than throwing', () => {
		// Not an absolute or ./ relative path, so `new Worker()` throws synchronously
		const monitor = track(new RespawnWorkerMonitor('not-a-valid-worker-path.js'))
		const events = recordEvents(monitor)

		expect(() => monitor.start()).not.toThrow()
		expect(events).toEqual(['warn', 'crash', 'stop'])
		expect(monitor.status).toBe('crashed')
	})

	it('stops a running worker', async () => {
		const monitor = track(new RespawnWorkerMonitor('setInterval(() => {}, 1000)', { eval: true }))
		const events = recordEvents(monitor)

		monitor.start()
		expect(monitor.status).toBe('running')
		expect(monitor.threadId).toBeTypeOf('number')

		await new Promise<void>((resolve) => monitor.stop(resolve))

		expect(monitor.status).toBe('stopped')
		expect(monitor.threadId).toBeUndefined()
		expect(events).toEqual(['spawn', 'start', 'exit', 'stop'])
	})
})

describe('RespawnMonitor', () => {
	it('respawns a process which exits, until maxRestarts is reached', async () => {
		const monitor = track(
			new RespawnMonitor([process.execPath, '-e', 'process.exit(2)'], { sleep: 10, maxRestarts: 1, env: process.env })
		)
		const exitCodes: Array<number | null> = []
		monitor.on('exit', (code) => exitCodes.push(code))

		monitor.start()
		await once(monitor, 'crash')

		expect(exitCodes).toEqual([2, 2])
		expect(monitor.status).toBe('crashed')
	})

	it.skipIf(process.platform === 'win32')('kills the whole process tree on stop', async () => {
		// The child spawns a grandchild and reports its pid, then both sleep
		const script = `
			const { spawn } = require('node:child_process')
			const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
			process.stdout.write(String(grandchild.pid) + '\\n')
			setInterval(() => {}, 1000)
		`
		const monitor = track(new RespawnMonitor([process.execPath, '-e', script], { env: process.env, kill: 2000 }))

		monitor.start()
		const [data] = (await once(monitor, 'stdout')) as [Buffer]
		const grandchildPid = parseInt(data.toString(), 10)
		expect(isAlive(grandchildPid)).toBe(true)

		await new Promise<void>((resolve) => monitor.stop(resolve))

		// Give the signal a moment to be delivered
		for (let i = 0; i < 50 && isAlive(grandchildPid); i++) await new Promise((r) => setTimeout(r, 20))
		expect(isAlive(grandchildPid)).toBe(false)
	})
})

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}
