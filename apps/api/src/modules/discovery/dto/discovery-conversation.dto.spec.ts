import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { DiscoveryRespondDto } from "./discovery-conversation.dto";

describe("DiscoveryRespondDto", () => {
  it("rejects overlong owner chat messages", async () => {
    const dto = plainToInstance(DiscoveryRespondDto, {
      message: "x".repeat(2001),
    });

    const errors = await validate(dto);

    expect(JSON.stringify(errors)).toContain("maxLength");
  });
});
