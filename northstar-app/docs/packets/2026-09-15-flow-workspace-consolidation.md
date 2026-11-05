# Flow workspace consolidation

The Flow workspace now registers as one stable Tools module instead of exposing
the summary, gauge cards, source list, and notice as four identically named
module pages. The single Flows page opens with the complete read-only source
health and current-observation layout intact.

This is a navigation-only follow-up to `packet-20260915-flow-assets`. The
operator-only snapshot route, public-source adapters, stale-data behavior, and
private-source boundary are unchanged.

Validation: `node tests/flows-workspace.test.cjs`, focused Flow tests, and the
complete Python suite: 265 passed.
