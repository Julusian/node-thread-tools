/**
 * Copyright 2013 Mathias Buus
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import {
	fork,
	spawn,
	type ChildProcessByStdio,
	type ForkOptions,
	type SpawnOptionsWithoutStdio,
	type StdioOptions,
} from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { isProcessAlive, killProcessTree } from './process-kill.js'
import { type BaseRespawnEvents, type BaseRespawnOptions, RespawnMonitorBase } from './respawn-base.js'

export interface RespawnOptions extends BaseRespawnOptions {
	cwd?: string
	env?: NodeJS.ProcessEnv
	uid?: number
	gid?: number

	stdio?: StdioOptions
	stdout?: NodeJS.WritableStream
	stderr?: NodeJS.WritableStream

	silent?: boolean
	fork?: boolean
	windowsVerbatimArguments?: boolean

	/**
	 * How long in ms to wait after SIGTERM before sending SIGKILL to anything left of the process tree. `false` to never
	 * escalate. Defaults to 30000
	 */
	kill?: number | false
}

export interface RespawnEvents extends BaseRespawnEvents<RespawnChild> {
	/** Emitted when part of the process tree didn't exit after SIGTERM, and was sent SIGKILL */
	'force-kill': []
}

export type RespawnChild = ChildProcessByStdio<null | Writable, null | Readable, null | Readable>

export class RespawnMonitor extends RespawnMonitorBase<RespawnChild, RespawnEvents> {
	/** The pid of the currently running child, or `undefined` when there is none */
	public pid: number | undefined

	private readonly command: string[] | (() => string[])
	private readonly cwd: string | undefined
	private readonly env: NodeJS.ProcessEnv | undefined
	private readonly uid: number | undefined
	private readonly gid: number | undefined
	private readonly _stdio: StdioOptions | undefined
	private readonly _stdout: NodeJS.WritableStream | undefined
	private readonly _stderr: NodeJS.WritableStream | undefined
	private readonly silent: boolean | undefined
	private readonly windowsVerbatimArguments: boolean | undefined
	private readonly spawnFn: (cmd: string, args: string[], opts: ForkOptions | SpawnOptionsWithoutStdio) => RespawnChild
	private readonly killDelay: number | false

	/** The current child process. Treat as read-only; primarily for low-level/internal use. */
	get child(): RespawnChild | null {
		return this._child
	}

	constructor(command: string[] | (() => string[]), opts: RespawnOptions) {
		super({ sleep: opts.sleep, maxRestarts: opts.maxRestarts })

		this.command = command
		this.cwd = opts.cwd || '.'
		this.env = opts.env || {}
		this.uid = opts.uid
		this.gid = opts.gid
		this._stdio = opts.stdio
		this._stdout = opts.stdout
		this._stderr = opts.stderr
		this.silent = opts.silent
		this.windowsVerbatimArguments = opts.windowsVerbatimArguments
		this.spawnFn = opts.fork ? fork : spawn
		this.killDelay = opts.kill === false ? false : (opts.kill ?? 30000)
	}

	protected spawnChild(): RespawnChild {
		const cmd = typeof this.command === 'function' ? this.command() : this.command
		const child = this.spawnFn(cmd[0], cmd.slice(1), {
			cwd: this.cwd,
			env: this.env || {},
			uid: this.uid,
			gid: this.gid,
			stdio: this._stdio,
			silent: this.silent,
			windowsVerbatimArguments: this.windowsVerbatimArguments,
		})
		this.pid = child.pid
		return child
	}

	protected setupChild(
		child: RespawnChild,
		onExit: (code: number | null, signal: string | null) => void,
		onError: (err: Error) => void
	): void {
		child.setMaxListeners(0)

		if (child.stdout) {
			child.stdout.on('data', (data: Buffer) => this.emit('stdout', data))
			if (this._stdout) child.stdout.pipe(this._stdout)
		}

		if (child.stderr) {
			child.stderr.on('data', (data: Buffer) => this.emit('stderr', data))
			if (this._stderr) child.stderr.pipe(this._stderr)
		}

		child.on('message', (message) => this.emit('message', message))
		child.on('error', onError)
		child.on('exit', onExit)
	}

	protected killChild(child: RespawnChild): void {
		const pid = child.pid
		if (!pid) return

		// Every process in the tree at the time of the SIGTERM. Any of these which ignore it and outlive their parent get
		// reparented, so can't be found again by walking the tree from the child.
		const signalledPids = killProcessTree(pid, 'SIGTERM').catch((e: unknown) => {
			this.emit('warn', e instanceof Error ? e : new Error(String(e)))
			return [pid]
		})

		const killDelay = this.killDelay
		if (killDelay === false) return

		const wait = setTimeout(() => {
			void signalledPids.then(async (pids) => {
				const survivors = pids.filter((p) => isProcessAlive(p))
				if (survivors.length === 0) return

				// Walk the tree again too, to catch anything spawned since the SIGTERM
				const newPids = isProcessAlive(pid) ? await killProcessTree(pid, 'SIGKILL').catch(() => []) : []
				for (const p of survivors) {
					if (newPids.includes(p)) continue
					try {
						process.kill(p, 'SIGKILL')
					} catch (_e) {
						// process already gone
					}
				}
				this.emit('force-kill')
			})
		}, killDelay)

		// Once the child has exited, only keep waiting if something it spawned is still running
		child.once('exit', () => {
			void signalledPids.then((pids) => {
				if (!pids.some((p) => isProcessAlive(p))) clearTimeout(wait)
			})
		})
	}

	protected addExitListener(child: RespawnChild, cb: () => void): void {
		child.on('exit', cb)
	}

	protected onChildCleared(): void {
		this.pid = undefined
	}
}
