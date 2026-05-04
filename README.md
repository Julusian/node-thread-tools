# thread-tools

A Node.js utility library for managing child processes and inter-process communication. It provides three main building blocks:

- **`IpcWrapper`** — typed, bidirectional RPC over any message transport
- **`RespawnMonitor`** — auto-restarting child process supervisor
- **`importModuleFromPath`** — cross-platform dynamic module loader (including webpack compatibility)

Requires Node.js ≥ 22.

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

#### `sendWithNoCb(name, payload)`

Sends a fire-and-forget message (the handler's return type must be `never`).

#### `receivedMessage(msg)`

Feed incoming raw packets into the wrapper. Call this whenever a message arrives from the transport.

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

---

### `importModuleFromPath(modulePath)`

Dynamically imports a module by file path, with a fallback to `require()` when running inside a webpack bundle.

```ts
import { importModuleFromPath } from 'thread-tools'

const mod = await importModuleFromPath('/absolute/path/to/plugin.js')
```

On Windows, file paths are automatically converted to `file://` URLs as required by the ESM loader.

## Development

```sh
yarn build       # compile TypeScript
yarn dev         # watch mode
yarn lint        # run ESLint
yarn lint-fix    # run ESLint with auto-fix
```
