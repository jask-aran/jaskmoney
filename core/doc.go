// Package core contains app-wide contracts and state orchestration.
//
// Allowed here:
// - model routing, message contracts, command and key registries
// - shared state machines used across tabs/screens (for example picker logic)
//
// Not allowed here:
// - concrete screen/modal rendering implementations
// - tab-specific layout policy
package core
