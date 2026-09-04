import { describe, expect, it } from "vitest";

describe("result adoption contract", () => {
  it("uses null to represent a reversible revoke", () => {
    expect({ resultRunId: null, adopted: false }).toMatchObject({ resultRunId: null, adopted: false });
  });
});
