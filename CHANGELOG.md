# Changelog — Stream Deck GitHub Utilities

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Workflow Status keys now call out a run held for approval. A run blocked by an environment
  protection rule reports `waiting`, which used to render with the same clock icon as a run queued
  for a runner — so the one state that needs a person to act looked like the one that needs
  nothing. It now gets its own icon, blinks to catch the eye, and names the environment and
  whether you are among the reviewers (`approve prod` versus `awaiting prod`). Pressing the key
  opens the run page, where the approval prompt lives. The extra API call only happens while a run
  is actually waiting.

### Changed

### Fixed

### Removed
