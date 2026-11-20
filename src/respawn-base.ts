import type { Serializable } from 'node:child_process'
import { EventEmitter } from 'node:events'

export type { Serializable }

const DEFAULT_SLEEP = 1000

function defaultSleep(sleep: number | number[] | undefined): (restarts: number) => number {
	// Note: `0` is a valid delay (restart immediately), so only fall back to the default when nothing was given
	const arr = Array.isArray(sleep) ? sleep : [sleep ?? DEFAULT_SLEEP]
	if (arr.length === 0) arr.push(DEFAULT_SLEEP)
	return (restarts: number): number => arr[restarts - 1] ?? arr[arr.length - 1]
}

export type RespawnStatus = 'stopped' | 'crashed' | 'running' | 'sleeping' | 'stopping'

export interface BaseRespawnEvents<TChild> {
	spawn: [child: TChild]
	crash: []
	stop: []
	start: []
	sleep: []
	exit: [code: number | null, signal: string | null]
	stdout: [data: Buffer]
	stderr: [data: Buffer]
	message: [data: Serializable]
	warn: [err: Error]
	/** Index signature required to satisfy EventEmitter<T>'s EventMap constraint. */
	[key: string]: any[]
}

export interface BaseRespawnOptions {
	/**
	 * Delay in ms before restarting. An array gives the delay for each successive restart, repeating the last value.
	 * A function is called with the restart count (starting at 1). Defaults to 1000
	 */
	sleep?: number | number[] | ((restarts: number) => number)
	/** Give up and report a crash after this many restarts within 60s. -1 (the default) is unlimited */
	maxRestarts?: number
}

export abstract class RespawnMonitorBase<
	TChild,
	TEvents extends BaseRespawnEvents<TChild>,
> extends EventEmitter<TEvents> {
	/** When false, a child which exits is not restarted, and the monitor stops instead */
	public shouldRestart: boolean = true

	#status: RespawnStatus = 'stopped'
	protected _child: TChild | null = null
	#started: Date | null = null
	#timeout: NodeJS.Timeout | undefined

	readonly #sleep: (restarts: number) => number
	readonly #maxRestarts: number

	constructor(opts: BaseRespawnOptions) {
		super()
		this.#sleep = typeof opts.sleep === 'function' ? opts.sleep : defaultSleep(opts.sleep)
		this.#maxRestarts = opts.maxRestarts === 0 ? 0 : (opts.maxRestarts ?? -1)
	}

	get status(): RespawnStatus {
		return this.#status
	}

	/** Emit a base event. Required because TypeScript cannot verify TEvents[K] ≥ BaseRespawnEvents[K] at the call site in a generic base class. */
	private emitBase<K extends keyof BaseRespawnEvents<TChild>>(event: K, ...args: BaseRespawnEvents<TChild>[K]): void {
		this.emit(event as any, ...(args as any))
	}

	protected abstract spawnChild(): TChild
	protected abstract setupChild(
		child: TChild,
		onExit: (code: number | null, signal: string | null) => void,
		onError: (err: Error) => void
	): void
	protected abstract killChild(child: TChild): void
	protected abstract addExitListener(child: TChild, cb: () => void): void
	/** Called when the tracked child reference is cleared. Override to reset type-specific identifiers (e.g. pid, threadId). */
	protected onChildCleared(): void {}

	/**
	 * Stop the child, and don't restart it. `cb` is called once the child has exited.
	 * When the monitor is already stopped or crashed this does nothing other than calling `cb`. A crashed monitor
	 * keeps its `crashed` status, and does not emit `stop` a second time.
	 */
	stop(cb?: () => void): void {
		if (this.#status === 'stopped' || this.#status === 'crashed') {
			if (cb) process.nextTick(cb)
			return
		}
		if (this.#status === 'stopping') {
			// Already stopping, so just wait for that to complete
			if (cb) {
				if (this._child) this.addExitListener(this._child, cb)
				else process.nextTick(cb)
			}
			return
		}
		this.#status = 'stopping'

		clearTimeout(this.#timeout)

		if (cb) {
			if (this._child) this.addExitListener(this._child, cb)
			else process.nextTick(cb)
		}

		if (!this._child) {
			this.#stopped()
			return
		}
		this.killChild(this._child)
	}

	start(): void {
		if (this.#status === 'running') return

		let restarts = 0
		let clock = 60000

		const loop = () => {
			let child: TChild
			try {
				child = this.spawnChild()
			} catch (e) {
				// Spawning failed synchronously (eg invalid options). Retrying would fail the same way, so treat it as a crash.
				// This can be run from a timer, so it must not be allowed to throw.
				this.emitBase('warn', e instanceof Error ? e : new Error(String(e)))
				this.#status = 'running'
				this.#crashed()
				return
			}

			this.#started = new Date()
			this.#status = 'running'
			this._child = child
			this.emitBase('spawn', child)

			const clear = () => {
				if (this._child !== child) return false
				this._child = null
				this.onChildCleared()
				return true
			}

			this.setupChild(
				child,
				(code, signal) => {
					this.emitBase('exit', code, signal)
					if (!clear()) return
					if (this.#status === 'stopping') {
						this.#stopped()
						return
					}

					clock -= Date.now() - (this.#started ? this.#started.getTime() : 0)

					if (clock <= 0) {
						clock = 60000
						restarts = 0
					}

					if (++restarts > this.#maxRestarts && this.#maxRestarts !== -1) {
						this.#crashed()
						return
					}
					if (!this.shouldRestart) {
						this.#stopped()
						return
					}

					this.#status = 'sleeping'
					this.emitBase('sleep')

					this.#timeout = setTimeout(loop, this.#sleep(restarts))
				},
				(err) => {
					this.emitBase('warn', err)
					if (!clear()) return
					if (this.#status === 'stopping') {
						this.#stopped()
						return
					}
					this.#crashed()
				}
			)
		}

		clearTimeout(this.#timeout)
		loop()

		// Read through the public getter to avoid TypeScript's narrowing of the private field
		if (this.status === 'running') this.emitBase('start')
	}

	#crashed(): void {
		if (this.#status !== 'running') return
		this.#status = 'crashed'
		this.emitBase('crash')
		if (this.#status === 'crashed') this.#stopped()
	}

	#stopped(): void {
		if (this.#status === 'stopped') return
		if (this.#status !== 'crashed') this.#status = 'stopped'
		this.#started = null
		this.emitBase('stop')
	}
}
