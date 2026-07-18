# Workflow

This repo uses a plain branch-and-pull-request flow, including for design-doc
edits — right now the design doc *is* the deliverable, so it gets the same
review discipline code would.

1. Before starting a new branch, fetch and pull `origin/main` so the branch
   starts from the current state, not a stale local copy.
2. All changes go on a topic branch. Nothing is committed directly to `main`.
3. Every change goes through a pull request. Rinie reviews and merges on
   GitHub — nothing here merges itself.
4. Delete the topic branch once its pull request is merged.
