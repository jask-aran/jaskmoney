// Package core contains app-wide contracts and state orchestration.
//
// Allowed here:
// - model routing, message contracts, command and key registries
// - shared state machines used across screens (for example picker logic)
// - tab and pane policy (tab definitions, pane host focus/jump behavior, tab layouts)
//
// Not allowed here:
// - concrete screen/modal rendering implementations
// - low-level widget rendering primitives
package core
