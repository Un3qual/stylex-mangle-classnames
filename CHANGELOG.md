# Changelog

## 0.2.0

### Minor Changes

- 63e6e2b: Rewrite runtime-injected StyleX classes before Vite 8 finalizes chunk hashes and production source maps.

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Accurate production JavaScript source maps for Vite's external, hidden, and inline modes.
- Class-selector collision detection for Rollup-emitted CSS rules.

### Changed

- JavaScript class names are rewritten before Vite calculates chunk hashes.
- Vite 8 is the supported peer version.
- Runtime-injected StyleX output is the supported compilation mode.

## 0.1.1

### Patch Changes

- 5d9c638: Discover generated class names from emitted StyleX rules so prefix-shaped application data and authored CSS are not rewritten.

## 0.1.0 - 2026-08-12

### Added

- Vite development-transform and production-output rewriting for generated StyleX atomic class names.
- Consistent mangling for matching CSS emitted late in Vite's production `writeBundle` phase.
- Deterministic bundle-wide short names from `a` through `z`, then `aa`, `ab`, and beyond.
- Protection for StyleX runtime constants, custom properties, keyframe suffixes, and unrelated authored classes.
- Authored-CSS collision detection and a fail-closed guard for unsupported production source maps.
