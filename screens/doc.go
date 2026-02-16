// Package screens contains concrete overlay flows rendered on top of tabs.
//
// Allowed here:
// - screen implementations that satisfy core.Screen (picker modal, command modal, editors)
// - modal-specific presentation and interaction wiring
//
// Not allowed here:
// - app-wide routing tables and key registry ownership
// - low-level widget/layout primitives
package screens
