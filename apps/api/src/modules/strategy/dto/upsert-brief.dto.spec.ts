import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpsertBriefDto } from "./upsert-brief.dto";

describe("UpsertBriefDto", () => {
  it("rejects a primary objective outside the Strategy contract", async () => {
    const dto = plainToInstance(UpsertBriefDto, {
      businessProfileVersionId: "8a7476dc-12c2-499f-97cf-b5febb4e2d2a",
      primaryObjective: "growth",
      startDate: "2026-08-03T00:00:00.000Z",
      planLanguage: "ar-EG",
      paidMediaAllowed: false,
      externalBudgetMode: "organic_only",
      teamCapacity: "2 hours per week",
    });

    const errors = await validate(dto);

    expect(JSON.stringify(errors)).toContain("isIn");
  });
});
