# Changelog

## [0.2.0](https://github.com/Julusian/node-thread-tools/compare/v0.1.2...v0.2.0) (2026-11-20)


### ⚠ BREAKING CHANGES

* stop() on a crashed monitor no longer emits 'stop' or changes the status from 'crashed', and its callback is now always called asynchronously. RespawnMonitor.pid is `undefined` rather than `0` when there is no child. The unused `id` and `crashed` properties have been removed.

### Features

* adopt IpcWrapper improvements from companion ([58c1cc8](https://github.com/Julusian/node-thread-tools/commit/58c1cc8a73dcce6af22227f5f3f9471f02ecde0c))
* export killProcessTree and isProcessAlive ([39ac8fb](https://github.com/Julusian/node-thread-tools/commit/39ac8fb7000e5029111977eb1b867bf4e16a26ab))


### Bug Fixes

* importModuleFromPath failing for paths containing # or % ([01f2437](https://github.com/Julusian/node-thread-tools/commit/01f24379b1fa0c1ff4fab2989fbf22dd936c9847))
* IpcWrapper dropping falsy results and ignoring synchronous handler throws ([0ae1f74](https://github.com/Julusian/node-thread-tools/commit/0ae1f740b95a48b47a6ef47f97fb01aa84e3bd2e))
* process tree kill missing descendants when pids are not ordered ([f36f94c](https://github.com/Julusian/node-thread-tools/commit/f36f94cd96b2f1e3ef53c8d57fe54d193b3a1d2f))
* respawn monitor restart delay, stop and kill escalation ([6c8480a](https://github.com/Julusian/node-thread-tools/commit/6c8480adf32dbfcd642792dfedbc5cc0c4a6fc4f))
* RespawnWorkerMonitor not respawning workers that throw ([930e6dd](https://github.com/Julusian/node-thread-tools/commit/930e6dd642a717eb22a38225061034f8c1c264dc))

## [0.1.2](https://github.com/Julusian/node-thread-tools/compare/v0.1.1...v0.1.2) (2026-05-04)


### Bug Fixes

* allow worker eval mode ([a5e5f40](https://github.com/Julusian/node-thread-tools/commit/a5e5f4090a5eac6f012cf23f59b287a071f19bee))

## [0.1.1](https://github.com/Julusian/node-thread-tools/compare/v0.1.0...v0.1.1) (2026-05-04)


### Bug Fixes

* package.json ([69a14cd](https://github.com/Julusian/node-thread-tools/commit/69a14cdbe7f7278bed33899143b182153c7ac8b6))

## [0.1.0](https://github.com/Julusian/node-thread-tools/compare/v0.0.1...v0.1.0) (2026-05-04)


### Features

* add worker_thread version ([881fd29](https://github.com/Julusian/node-thread-tools/commit/881fd295dd2b17f0cef26880f72546890bde5fc4))
