import type { Serializable } from 'node:child_process'
import { EventEmitter } from 'node:events'

export type { Serializable }

function defaultSleep(sleep: number | number[] | undefined): (restarts: number) => number {
	const arr = Array.isArray(sleep) ? sleep : [sleep || 1000]
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
	sleep?: number | number[] | ((restarts: number) => number)
	maxRestarts?: number
}

export abstract class RespawnMonitorBase<
	TChild,
	TEvents extends BaseRespawnEvents<TChild>,
> extends EventEmitter<TEvents> {
	public id: string | null = null
	public crashed: boolean = false
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

	stop(cb?: () => void): void {
		if (this.#status === 'stopped' || this.#status === 'stopping') {
			cb?.()
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
			const child = this.spawnChild()

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
