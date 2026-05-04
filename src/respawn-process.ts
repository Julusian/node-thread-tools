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
import { kill } from './process-kill.js'
import { type BaseRespawnEvents, RespawnMonitorBase } from './respawn-base.js'

export interface RespawnOptions {
	// name?: string
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

	sleep?: number | number[] | ((restarts: number) => number)
	maxRestarts?: number
	kill?: number | false
}

export interface RespawnEvents extends BaseRespawnEvents<RespawnChild> {
	'force-kill': []
}

export type RespawnChild = ChildProcessByStdio<null | Writable, null | Readable, null | Readable>

export class RespawnMonitor extends RespawnMonitorBase<RespawnChild, RespawnEvents> {
	public pid: number | undefined = 0

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
		if (this.killDelay !== false) {
			const wait = setTimeout(() => {
				if (!child.pid) return
				kill(child.pid, 'SIGKILL')
				this.emit('force-kill')
			}, this.killDelay)
			child.on('exit', () => clearTimeout(wait))
		}
		if (child.pid) kill(child.pid)
	}

	protected addExitListener(child: RespawnChild, cb: () => void): void {
		child.on('exit', cb)
	}

	protected onChildCleared(): void {
		this.pid = 0
	}
}
