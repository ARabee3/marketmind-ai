import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  LanguageModeDto,
  SocialPlatformDto,
  StartDiscoveryDto,
} from "./start-discovery.dto";

describe("StartDiscoveryDto", () => {
  it("rejects overlong free text and too many social links", async () => {
    const dto = plainToInstance(StartDiscoveryDto, {
      language_mode: LanguageModeDto.Mixed,
      intake: {
        business_name: "x".repeat(121),
        business_type: "restaurant",
        city: "Cairo",
        owner_goal_text: "x".repeat(1001),
        social_links: Array.from({ length: 9 }, (_, index) => ({
          platform: SocialPlatformDto.Website,
          url: `https://example.com/${index}`,
        })),
      },
    });

    const errors = await validate(dto);

    expect(JSON.stringify(errors)).toContain("maxLength");
    expect(JSON.stringify(errors)).toContain("arrayMaxSize");
  });

  it("requires social links to use an explicit http or https URL", async () => {
    const dto = plainToInstance(StartDiscoveryDto, {
      intake: {
        business_name: "Koshary Corner",
        business_type: "restaurant",
        city: "Cairo",
        social_links: [
          {
            platform: SocialPlatformDto.Website,
            url: "ftp://example.com/profile",
          },
        ],
      },
    });

    const errors = await validate(dto);

    expect(JSON.stringify(errors)).toContain("isUrl");
  });
});
