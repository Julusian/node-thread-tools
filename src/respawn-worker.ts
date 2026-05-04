import { Worker, SHARE_ENV, type WorkerOptions, type ResourceLimits } from 'node:worker_threads'
import type { Serializable } from 'node:child_process'
import { type BaseRespawnEvents, type BaseRespawnOptions, RespawnMonitorBase } from './respawn-base.js'

export type { ResourceLimits }

export interface RespawnWorkerOptions extends BaseRespawnOptions {
	env?: NodeJS.ProcessEnv | typeof SHARE_ENV
	/**
	 * When `true`, the `filename` passed to the constructor is treated as an
	 * inline JavaScript script to evaluate rather than a file path.
	 */
	eval?: boolean
	/**
	 * Data passed to the worker via `workerData`. If a function is provided it is
	 * called on every (re)spawn so each new worker instance receives fresh data.
	 */
	workerData?: unknown | (() => unknown)
	argv?: unknown[]
	execArgv?: string[]
	stdin?: boolean
	/**
	 * Capture the worker's stdout. Pass `true` to emit `stdout` data events, or
	 * pass a `WritableStream` to additionally pipe the output there.
	 * When falsy the worker's stdout is forwarded directly to the parent process.
	 */
	stdout?: boolean | NodeJS.WritableStream
	/**
	 * Capture the worker's stderr. Pass `true` to emit `stderr` data events, or
	 * pass a `WritableStream` to additionally pipe the output there.
	 * When falsy the worker's stderr is forwarded directly to the parent process.
	 */
	stderr?: boolean | NodeJS.WritableStream
	resourceLimits?: ResourceLimits
	name?: string
}

export interface RespawnWorkerEvents extends BaseRespawnEvents<Worker> {
	/** Emitted when the worker thread has started executing. */
	online: []
	/** Emitted when deserializing a message from the worker fails. */
	messageerror: [error: Error]
}

export class RespawnWorkerMonitor extends RespawnMonitorBase<Worker, RespawnWorkerEvents> {
	/** The `threadId` of the currently running worker, or `undefined` when stopped. */
	public threadId: number | undefined

	private readonly filename: string | URL | (() => string | URL)
	private readonly evalMode: boolean
	private readonly workerData: unknown | (() => unknown)
	private readonly workerEnv: NodeJS.ProcessEnv | typeof SHARE_ENV | undefined
	private readonly argv: unknown[] | undefined
	private readonly execArgv: string[] | undefined
	private readonly stdin: boolean | undefined
	private readonly captureStdout: boolean
	private readonly captureStderr: boolean
	private readonly pipeStdout: NodeJS.WritableStream | undefined
	private readonly pipeStderr: NodeJS.WritableStream | undefined
	private readonly resourceLimits: ResourceLimits | undefined
	private readonly workerName: string | undefined

	/** The currently running `Worker` instance, or `null` when stopped. */
	get worker(): Worker | null {
		return this._child
	}

	constructor(filename: string | URL | (() => string | URL), opts: RespawnWorkerOptions = {}) {
		super({ sleep: opts.sleep, maxRestarts: opts.maxRestarts })

		this.filename = filename
		this.evalMode = opts.eval ?? false
		this.workerData = opts.workerData
		this.workerEnv = opts.env
		this.argv = opts.argv
		this.execArgv = opts.execArgv
		this.stdin = opts.stdin
		this.captureStdout = !!opts.stdout
		this.captureStderr = !!opts.stderr
		this.pipeStdout = typeof opts.stdout === 'object' && opts.stdout !== null ? opts.stdout : undefined
		this.pipeStderr = typeof opts.stderr === 'object' && opts.stderr !== null ? opts.stderr : undefined
		this.resourceLimits = opts.resourceLimits
		this.workerName = opts.name
	}

	protected spawnChild(): Worker {
		const file = typeof this.filename === 'function' ? this.filename() : this.filename
		const workerData = typeof this.workerData === 'function' ? (this.workerData as () => unknown)() : this.workerData

		const workerOptions: WorkerOptions = {
			env: this.workerEnv,
			eval: this.evalMode,
			workerData,
			argv: this.argv as string[] | undefined,
			execArgv: this.execArgv,
			stdin: this.stdin,
			stdout: this.captureStdout,
			stderr: this.captureStderr,
			resourceLimits: this.resourceLimits,
			name: this.workerName,
		}

		const worker = new Worker(file, workerOptions)
		this.threadId = worker.threadId
		return worker
	}

	protected setupChild(
		worker: Worker,
		onExit: (code: number | null, signal: string | null) => void,
		onError: (err: Error) => void
	): void {
		worker.on('online', () => this.emit('online'))
		worker.on('message', (message) => this.emit('message', message as Serializable))
		worker.on('messageerror', (err) => this.emit('messageerror', err))
		worker.on('error', onError)
		worker.on('exit', (code) => onExit(code, null))

		if (this.captureStdout) {
			worker.stdout.on('data', (data: Buffer) => this.emit('stdout', data))
			if (this.pipeStdout) worker.stdout.pipe(this.pipeStdout)
		}

		if (this.captureStderr) {
			worker.stderr.on('data', (data: Buffer) => this.emit('stderr', data))
			if (this.pipeStderr) worker.stderr.pipe(this.pipeStderr)
		}
	}

	protected killChild(worker: Worker): void {
		worker.terminate().catch(() => {
			// Worker already exited — race condition between stop() and the exit event, safe to ignore
		})
	}

	protected addExitListener(worker: Worker, cb: () => void): void {
		worker.on('exit', cb)
	}

	protected onChildCleared(): void {
		this.threadId = undefined
	}
}
