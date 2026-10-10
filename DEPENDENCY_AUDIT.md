# Dependency security audit

Checked with npm audit on October 10, 2026. Counts include transitive packages affected by the same advisory; they are not counts of independent vulnerabilities.

| Dependency tree | Before: high / moderate | After: high / moderate | Critical |
| --- | --- | --- | --- |
| Frontend | 54 / 17 | 49 / 16 | 0 |
| Backend | 30 / 6 | 3 / 19 | 0 |
| Root | 0 / 0 | 0 / 0 | 0 |

## Changes

- Replaced expo-three's renderer wrapper with a local Three.js / Expo GL adapter. This removes its legacy browser polyfill, vulnerable node-fetch 1.x dependency, and incompatible React Native / Expo FileSystem peer requirements.
- Replaced the backend uuid package with Node's built-in crypto.randomUUID; existing UUID v4 identifiers retain their format.
- Updated backend Jest and @jest/globals to 30.5.2 and adjusted the ESM test configuration.
- Applied npm audit fix without --force in frontend and backend.
- Enabled tracking of npm lockfiles to preserve reviewed dependency resolutions.
- Preserved the Expo 57 SDK dependency set, React Native, Reanimated, Worklets, and Nodemon 3.

## Remaining advisories

- [braces: deeply nested pattern denial of service](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): build/test tooling and Nodemon's watcher chain. The three remaining high-severity backend package flags are braces, chokidar, and nodemon.
- [sprintf-js: unbounded precision denial of service](https://github.com/advisories/GHSA-hp3w-g68c-fv3c): test/tooling dependencies in both trees.
- [decode-uri-component: malformed URI denial of service](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr): frontend Expo Router / query-string dependency.
- [node-forge: RSA signature verification](https://github.com/advisories/GHSA-86w9-cpqp-85rv): frontend tooling dependency.
- [uuid: buffer bounds checks](https://github.com/advisories/GHSA-w5hq-g745-h8pq): transitive frontend dependencies; the backend direct dependency was removed.

These findings remain unresolved. A package flag does not prove that the application exposes the vulnerable function to untrusted input. Keep development tooling off public networks and review upstream fixes before updating the SDK dependency set.

Do not apply npm audit fix --force automatically. Its preview mixed Expo 44, Expo Router 58, React Native 0.87, and other incompatible SDK versions, and proposed downgrading Nodemon to 1.14.10.

## Verification

- Six backend authentication and ML/layout regression checks passed.
- Three backend Jest validation tests passed.
- Two frontend native/web renderer-adapter tests passed.
- Isolated strict TypeScript check for the renderer adapter and its tests passed.
- Expo's offline dependency version check passed; offline validation has limited coverage.
- npm ls reported no frontend dependency problems.
- An Android export was stopped after Metro remained at startup without completing; Android bundling and device rendering are not verified.

This is an npm dependency audit. Python ML dependencies and an Android device runtime session were not audited by these checks.
