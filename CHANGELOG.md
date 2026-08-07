# Changelog — Stream Deck GitHub Utilities

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

### Changed

### Fixed

- Workflow Status: the Branch filter now also narrows the deployment lookup. It previously applied
  only to the workflow run, so the deployment shown could come from any branch — and since an
  active deployment takes precedence in the display, a key watching `develop` would report an
  in-progress `prod` deployment instead of its own pipeline. Most visible with Environment set to
  "All Environments", where the lookup was completely unfiltered and every such key converged on
  the repository's newest deployment. Branch and Environment now work alone and in combination.

### Removed
