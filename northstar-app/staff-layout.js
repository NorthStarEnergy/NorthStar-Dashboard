/**
 * Superseded by module-layout.js on 2026-08-11. Intentionally does nothing.
 *
 * This file made Field Staff cards free-floating via transform: translate(),
 * which let a card be dragged outside its section and over unrelated panels,
 * and it only ever worked for that one panel. module-layout.js replaces it with
 * reorder-and-reflow zones that apply to Field Staff, market pricing and
 * weather alike.
 *
 * Kept as a stub rather than deleted so any stale reference fails quietly
 * instead of resurrecting the free-floating behaviour alongside the new system.
 * Remove it once nothing references staff-layout.js.
 */
