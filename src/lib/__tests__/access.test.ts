import { describe, expect, it } from "vitest"

import {
  ACCESS_ROLES,
  AGENT_CATALOG,
  FEATURE_CATALOG,
  buildFeatureMatrix,
  isManagedAgent,
  isManagedFeature,
} from "@/lib/access"

describe("access catalog", () => {
  it("keeps agents separate from UI feature flags", () => {
    expect(FEATURE_CATALOG.map((feature) => feature.key)).toEqual([
      "training",
      "connectors_manage",
      "export",
    ])
    expect(AGENT_CATALOG.map((agent) => agent.key)).toContain("connector")
    expect(isManagedFeature("agent:connector")).toBe(false)
    expect(isManagedAgent("connector")).toBe(true)
  })

  it("accepts orchestrated as a result-only agent without exposing it to access UI", () => {
    expect(isManagedAgent("orchestrated")).toBe(true)
    expect(AGENT_CATALOG.map((agent) => agent.key)).not.toContain("orchestrated")
    expect(isManagedAgent("nonsense")).toBe(false)
  })

  it("builds a full role-feature matrix with false defaults", () => {
    const matrix = buildFeatureMatrix([
      { role: "admin", feature: "training", enabled: true },
      { role: "viewer", feature: "export", enabled: false },
    ])

    expect(Object.keys(matrix.training)).toEqual([...ACCESS_ROLES])
    expect(matrix.training.admin).toBe(true)
    expect(matrix.training.manager).toBe(false)
    expect(matrix.export.viewer).toBe(false)
  })
})
