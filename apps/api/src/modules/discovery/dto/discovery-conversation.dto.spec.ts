import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  ConfirmProfileDto,
  DiscoveryRespondDto,
  DiscoverySummarizeDto,
} from "./discovery-conversation.dto";
import { emptyMarketAwareBusinessFacts } from "../market-profile";

describe("DiscoveryRespondDto", () => {
  it("rejects overlong owner chat messages", async () => {
    const dto = plainToInstance(DiscoveryRespondDto, {
      message: "x".repeat(2001),
    });

    const errors = await validate(dto);

    expect(JSON.stringify(errors)).toContain("maxLength");
  });
});

describe("Discovery completion DTOs", () => {
  it("accepts the explicit early-finish flag", async () => {
    const dto = plainToInstance(DiscoverySummarizeDto, {
      finish_anyway: true,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it("accepts a v5 profile draft id produced by the AI service", async () => {
    const dto = plainToInstance(ConfirmProfileDto, {
      profile_draft_id: "961752b0-ec14-583c-9dc8-a58b43ab5e9b",
      owner_confirmation: true,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it("rejects non-boolean incomplete acknowledgements", async () => {
    const dto = plainToInstance(ConfirmProfileDto, {
      profile_draft_id: "99999999-9999-4999-8999-999999999999",
      owner_confirmation: true,
      acknowledge_incomplete: "yes",
    });

    const errors = await validate(dto);

    expect(JSON.stringify(errors)).toContain("isBoolean");
  });

  it("accepts a well-formed owner-edited facts payload", async () => {
    const dto = plainToInstance(ConfirmProfileDto, {
      profile_draft_id: "99999999-9999-4999-8999-999999999999",
      owner_confirmation: true,
      confirmed_facts: {
        ...emptyMarketAwareBusinessFacts(),
        identity: {
          business_name: "Koshary Corner",
          business_type: "restaurant",
          city: "Cairo",
          area: "Zamalek",
        },
      },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it("rejects malformed owner-edited facts payloads", async () => {
    const dto = plainToInstance(ConfirmProfileDto, {
      profile_draft_id: "99999999-9999-4999-8999-999999999999",
      owner_confirmation: true,
      confirmed_facts: {
        ...emptyMarketAwareBusinessFacts(),
        offer: "not-an-object",
      },
    });

    const errors = await validate(dto);

    expect(JSON.stringify(errors)).toContain("isMarketAwareBusinessFacts");
  });
});
