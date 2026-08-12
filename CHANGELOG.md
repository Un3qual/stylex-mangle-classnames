# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 - 2026-08-12

Not yet published.

### Added

- Vite development-transform and production-output rewriting for generated StyleX atomic class names.
- Consistent mangling for extracted StyleX CSS emitted late in Vite's production `writeBundle` phase.
- Deterministic bundle-wide short names from `a` through `z`, then `aa`, `ab`, and beyond.
- Protection for StyleX runtime constants, custom properties, keyframe suffixes, and unrelated authored classes.
- Authored-CSS collision detection and a fail-closed guard for unsupported production source maps.
