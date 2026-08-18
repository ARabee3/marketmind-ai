import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { DecideOptimizationProposalDto } from "./decide-optimization-proposal.dto";

describe("DecideOptimizationProposalDto", () => {
  const validInput = {
    action: "approve",
    evidence_checksum:
      "b7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0",
    idempotency_key: "optimization-decision-1",
  };

  it("accepts a non-empty decision idempotency key", async () => {
    const errors = await validate(
      plainToInstance(DecideOptimizationProposalDto, validInput),
    );

    expect(errors).toHaveLength(0);
  });

  it("rejects an idempotency key containing only whitespace", async () => {
    const errors = await validate(
      plainToInstance(DecideOptimizationProposalDto, {
        ...validInput,
        idempotency_key: "   ",
      }),
    );

    expect(JSON.stringify(errors)).toContain("non-whitespace");
  });
});
