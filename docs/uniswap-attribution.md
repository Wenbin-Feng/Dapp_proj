# Uniswap V2 dependency provenance

This demonstration **reuses**, rather than reimplements, Uniswap V2. The deployed
Factory/Pair use the published `@uniswap/v2-core@1.0.1` build artifacts; Router02
and WETH9 use `@uniswap/v2-periphery@1.1.0-beta.0`. The original Solidity 0.5.16 /
0.6.6 artifacts are used as a matched set; they are not rebuilt with our compiler.

Both packages are GPL-3.0-or-later. Their source, notices and license are preserved
in the pinned npm distributions and upstream repositories:

- [Uniswap V2 core source and GPL license](https://github.com/Uniswap/v2-core)
- [Uniswap V2 periphery source and GPL license](https://github.com/Uniswap/v2-periphery)

`scripts/uniswap.mjs` checks the Pair creation bytecode hash against Router02's
embedded init-code hash. Deployment also checks CREATE2 vs Factory `getPair`,
Router factory/WETH, disabled protocol fee, and a successful routed quote after
seeding. Tests cover the actual upstream bytecode. The frontend only exposes the
PDC/PDQ pair, even though the underlying standard contracts support other pairs.

OpenZeppelin 5.6.1 is MIT licensed; its copyright/license remain in the dependency.
The new application code and deployment scripts do not constitute an audit of
the upstream protocol or this integration. Preserve this provenance and upstream
licenses when distributing the deployment and contract artifacts.
