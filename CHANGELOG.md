# Changelog — Stream Deck GitHub Utilities

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

### Changed

- Batched GraphQL responses are now extracted once per parameter variant instead of once per
  fragment, so subscribers of the same fragment with different settings each get their own value
  out of a single request.

### Fixed

- Actions watching the same repository with different settings no longer show each other's data.
  The data cache was keyed by repository and fragment name only, so the parameters that shape the
  request were dropped: two Branch Comparison keys comparing different branch pairs, two Workflow
  Status keys following different workflows or environments, or a pair of PR/Issue counters
  configured for different states would all render whichever variant happened to be fetched first.
  Cache keys now include those parameters.

### Removed
