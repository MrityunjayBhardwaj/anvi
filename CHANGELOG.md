# Changelog

All notable changes to Ānvīkṣikī are documented here.
Format: [Semantic Versioning](https://semver.org/)

## [0.3.0] — 2026-03-23

### Changed
- Hetvābhāsa entries lead with root cause, not workaround cascade
- "Min 3 observations" → signal-based threshold ("gather until unsurprising")
- Modes → lenses (applied simultaneously, not sequentially)
- Recovery is a base-layer failure signal — triggers "which check should have caught this?"
- Pañcāvayava scoped to behavioral changes only (skip for renames, imports, formatting)

### Added
- Output translation layer — adapts to user profile language or generalized English
- GSD hooks loading mechanism (3 concrete integration paths)
- Catalogue maintenance protocol (review + prune at every 10th entry)
- Collaborative knowledge (vāda) in base layer — input type classification, credibility-aware disagreement
- "When NOT to use this" self-test in README
- Base-layer reinforcement protocol after every recovery

## [0.2.0] — 2026-03-23

### Changed
- All examples in templates are now project-agnostic (generic)
- Removed all struCode/Strudel/p5.js-specific references from framework

### Added
- Empty "Project-Specific" sections in all catalogue templates

## [0.1.0] — 2026-03-23

### Added
- Cognitive OS base layer (7 action checks, 2 interaction checks)
- Four lenses: diagnose, design, review, recover
- Context rot prevention (tattva checkpoint, selective pratiprasava)
- Translation layer (Sanskrit → plain English, 40+ term mappings)
- Reference templates: hetvābhāsa, vyāpti, krama (6 universal entries each)
- GSD compatibility hooks: executor, planner, checker, debugger
- README with architecture overview and philosophy
