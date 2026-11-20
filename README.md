# thread-tools

A Node.js utility library for managing child processes, worker threads and inter-process communication. It provides:

- **`IpcWrapper`** — typed, bidirectional RPC over any message transport
- **`RespawnMonitor`** — auto-restarting child process supervisor
- **`RespawnWorkerMonitor`** — auto-restarting worker thread supervisor
- **`killProcessTree`** — signal a process and all of its descendants
- **`importModuleFromPath`** — cross-platform dynamic module loader (including webpack compatibility)

Requires Node.js ≥ 22.12.

## Installation

```sh
npm install thread-tools
# or
yarn add thread-tools
```

## API

### `IpcWrapper<TOutbound, TInbound>`

A typed request/response wrapper that works over any transport (Worker threads, child processes, WebSockets, etc.). Both sides define their outbound and inbound message shapes as TypeScript interfaces.

```ts
import { IpcWrapper, IpcEventHandlers } from 'thread-tools'

interface ParentToChild {
	doWork: (data: { input: string }) => string
	notify: (data: { message: string }) => never // fire-and-forget (no return)
}

interface ChildToParent {
	log: (data: { text: string }) => never
}

// On the child side:
const handlers: IpcEventHandlers<ParentToChild> = {
	doWork: async ({ input }) => `processed: ${input}`,
	notify: async ({ message }) => {
		console.log(message)
	},
}

const ipc = new IpcWrapper<ChildToParent, ParentToChild>(
	handlers,
	(msg) => process.send!(msg), // send function — adapt to your transport
	5000 // default timeout in ms
)

// Receive messages from the other side:
process.on('message', (msg) => ipc.receivedMessage(msg as any))

// Send a fire-and-forget message:
ipc.sendWithNoCb('log', { text: 'hello from child' })

// On the parent side — call the child and await a response:
const result = await ipc.sendWithCb('doWork', { input: 'hello' })
```

#### `sendWithCb(name, payload, defaultResponse?, timeout?, signal?)`

Sends a call and returns a `Promise` that resolves with the handler's return value. Rejects on timeout or if the provided `AbortSignal` is triggered. The caller side automatically sends a cancellation notice to the remote so it can abort in-progress work.

If the handler throws, the promise rejects with an `Error` carrying the remote `name`, `message` and `stack` (and any extra properties such as `code`), with the local call site appended to the stack after a `--- via IPC call ---` marker. A thrown non-`Error` string is wrapped in an `Error`.

#### `sendWithNoCb(name, payload)`

Sends a fire-and-forget message (the handler's return type must be `never`).

#### `receivedMessage(msg)`

Feed incoming raw packets into the wrapper. Call this whenever a message arrives from the transport.

#### `rejectAllPending(error)`

Rejects every outbound call still awaiting a response, and aborts the signal of every inbound call still being handled. Call this when the other side has gone away (crashed, stopped or restarted), so callers find out immediately rather than when their timeout expires. No cancel messages are sent.

#### `replaceHandlers(handlers)`

Swaps the inbound handler table, eg to expose a larger API once the other side has completed a registration step.

---

### `RespawnMonitor`

An auto-restarting child process supervisor inspired by [`respawn`](https://github.com/mafintosh/respawn). Spawns a command and automatically restarts it after a configurable delay when it exits unexpectedly.

```ts
import { RespawnMonitor } from 'thread-tools'

const monitor = new RespawnMonitor(['node', 'worker.js'], {
	cwd: '/path/to/app',
	env: process.env,
	sleep: [250, 500, 1000, 5000], // escalating restart delays (ms)
	maxRestarts: 10, // -1 = unlimited
	kill: 30000, // ms before SIGKILL after SIGTERM
	fork: false, // set true to use child_process.fork()
})

monitor.on('start', () => console.log('started'))
monitor.on('stop', () => console.log('stopped'))
monitor.on('crash', () => console.log('crashed — gave up restarting'))
monitor.on('sleep', () => console.log('waiting before restart'))
monitor.on('spawn', (child) => console.log('new pid:', child.pid))
monitor.on('exit', (code, signal) => console.log('exited', code, signal))
monitor.on('stdout', (data) => process.stdout.write(data))
monitor.on('stderr', (data) => process.stderr.write(data))
monitor.on('warn', (err) => console.error('error:', err))

monitor.start()

// Later, stop and wait for the child to exit:
monitor.stop(() => console.log('fully stopped'))
```

#### Options (`RespawnOptions`)

| Option              | Type                             | Default          | Description                                              |
| ------------------- | -------------------------------- | ---------------- | -------------------------------------------------------- |
| `cwd`               | `string`                         | `'.'`            | Working directory for the child process                  |
| `env`               | `object`                         | `{}`             | Environment variables                                    |
| `uid` / `gid`       | `number`                         | —                | Run as a specific user/group                             |
| `stdio`             | `StdioOptions`                   | —                | Standard I/O configuration                               |
| `stdout` / `stderr` | `WritableStream`                 | —                | Pipe child output to a stream                            |
| `silent`            | `boolean`                        | —                | Suppress child stdio (fork mode)                         |
| `fork`              | `boolean`                        | `false`          | Use `child_process.fork()` instead of `spawn()`          |
| `sleep`             | `number \| number[] \| function` | `1000`           | Delay(s) between restarts in ms                          |
| `maxRestarts`       | `number`                         | `-1` (unlimited) | Stop after this many restarts in a 60 s window           |
| `kill`              | `number \| false`                | `30000`          | Timeout before escalating to SIGKILL; `false` to disable |

The `command` argument may also be a `() => string[]` factory, called fresh on each spawn.

`sleep` may be `0` to restart immediately. An array gives the delay for each successive restart, repeating the last value once exhausted. A function is called with the restart count (starting at 1).

#### Stopping

`stop(cb?)` sends `SIGTERM` to the child and all of its descendants, and calls `cb` once the child has exited. If anything in that tree is still running once the `kill` timeout passes, it is sent `SIGKILL` and `force-kill` is emitted. This includes descendants which ignored `SIGTERM` and outlived the child itself. On Windows the tree is always terminated forcefully with `taskkill /T /F`.

Calling `stop()` while already stopping waits for the same exit. Calling it on a stopped or crashed monitor just calls `cb`, and a crashed monitor keeps its `crashed` status.

#### Properties

| Property        | Description                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `status`        | `'stopped' \| 'running' \| 'sleeping' \| 'stopping' \| 'crashed'`          |
| `pid`           | Pid of the current child, or `undefined`                                   |
| `child`         | The current `ChildProcess`, or `null`                                      |
| `shouldRestart` | Set to `false` to stop (rather than restart) the next time the child exits |

#### Events

| Event                      | Description                                                                   |
| -------------------------- | ----------------------------------------------------------------------------- |
| `start`                    | The monitor was started                                                       |
| `spawn` (child)            | A new child was spawned, either on start or a restart                         |
| `exit` (code, signal)      | The child exited                                                              |
| `sleep`                    | Waiting before the next restart                                               |
| `crash`                    | Gave up restarting (`maxRestarts` reached, or the child could not be spawned) |
| `stop`                     | The monitor stopped, either from `stop()` or after a crash                    |
| `warn` (err)               | A non-fatal error, eg the child emitted `'error'`                             |
| `stdout` / `stderr` (data) | Output from the child, when its stdio is piped                                |
| `message` (data)           | An IPC message from the child                                                 |
| `force-kill`               | Part of the process tree was sent `SIGKILL` after the `kill` timeout          |

---

### `RespawnWorkerMonitor`

The same supervisor, for a `worker_threads` `Worker` instead of a child process. It has the same `start()`, `stop()`, `status`, `shouldRestart` and events (except `force-kill`), plus `online` and `messageerror`.

```ts
import { RespawnWorkerMonitor } from 'thread-tools'

const monitor = new RespawnWorkerMonitor(new URL('./worker.js', import.meta.url), {
	workerData: () => ({ startedAt: Date.now() }), // called on each spawn
	sleep: [250, 1000, 5000],
	maxRestarts: 10,
	stderr: true, // emit 'stderr' events, rather than writing to the parent's stderr
})

monitor.on('online', () => console.log('worker running, threadId', monitor.threadId))
monitor.on('message', (msg) => console.log('from worker:', msg))
monitor.on('warn', (err) => console.error('worker threw:', err))

monitor.start()
monitor.worker?.postMessage('hello')
```

An uncaught exception in the worker is emitted as `warn`, and the worker is then restarted like any other exit. Stopping uses `worker.terminate()`, so there is no `kill` timeout.

#### Options (`RespawnWorkerOptions`)

| Option                | Type                        | Default | Description                                                              |
| --------------------- | --------------------------- | ------- | ------------------------------------------------------------------------ |
| `eval`                | `boolean`                   | `false` | Treat the first argument as code to evaluate, rather than a path or URL  |
| `workerData`          | `unknown \| () => unknown`  | —       | Passed to the worker as `workerData`. A function is called on each spawn |
| `env`                 | `object \| SHARE_ENV`       | —       | Environment for the worker                                               |
| `argv` / `execArgv`   | `array`                     | —       | Passed through to `Worker`                                               |
| `stdin`               | `boolean`                   | —       | Provide a writable `worker.stdin`                                        |
| `stdout` / `stderr`   | `boolean \| WritableStream` | —       | `true` to emit `stdout`/`stderr` events, a stream to also pipe there     |
| `resourceLimits`      | `ResourceLimits`            | —       | Passed through to `Worker`                                               |
| `name`                | `string`                    | —       | Thread name, for debugging                                               |
| `sleep`/`maxRestarts` |                             |         | As for `RespawnMonitor`                                                  |

The filename may also be a `() => string | URL` factory, called fresh on each spawn.

---

### `killProcessTree(pid, signal?)` / `isProcessAlive(pid)`

`killProcessTree` sends a signal (default `SIGTERM`) to a process and all of its descendants, and resolves with every pid it signalled. Keep that list to check on them later: a descendant which outlives its parent gets reparented, so can't be found again by walking the tree. On Windows it always forcefully terminates the tree with `taskkill /T /F`, and resolves with just `[pid]`.

`isProcessAlive` reports whether a pid is still running (and owned by the current user).

---

### `importModuleFromPath(modulePath)`

Dynamically imports a module by file path, with a fallback to `require()` when running inside a webpack bundle.

```ts
import { importModuleFromPath } from 'thread-tools'

const mod = await importModuleFromPath('/absolute/path/to/plugin.js')
```

Absolute file paths are converted to `file://` URLs, as required by the ESM loader on Windows and for paths containing characters such as `#` or `%`.

## Development

```sh
yarn build       # compile TypeScript
yarn dev         # watch mode
yarn lint        # run ESLint
yarn lint-fix    # run ESLint with auto-fix
yarn test        # run the tests
yarn typecheck   # typecheck the sources and tests
```
