import { Test, TestingModule } from "@nestjs/testing";

import { MailDeliveryError } from "./mail-delivery.error";
import { MAIL_PROVIDER, MailProvider } from "./mail-provider";
import { MailService } from "./mail.service";

const createMockMailProvider = (): jest.Mocked<MailProvider> => ({
  send: jest.fn(),
});

describe("MailService", () => {
  let service: MailService;
  let provider: jest.Mocked<MailProvider>;

  beforeEach(async () => {
    provider = createMockMailProvider();

    const module: TestingModule = await Test.createTestingModule({
      providers: [MailService, { provide: MAIL_PROVIDER, useValue: provider }],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  afterEach(() => jest.clearAllMocks());

  it("delegates email delivery to the injected provider", async () => {
    provider.send.mockResolvedValue(undefined);

    await service.sendMail("user@example.com", "Subject", "<p>body</p>");

    expect(provider.send).toHaveBeenCalledWith(
      "user@example.com",
      "Subject",
      "<p>body</p>",
    );
  });

  it("propagates normalized delivery failures", async () => {
    provider.send.mockRejectedValue(new MailDeliveryError("Provider failed"));

    await expect(
      service.sendMail("user@example.com", "Subject", "<p>body</p>"),
    ).rejects.toBeInstanceOf(MailDeliveryError);
  });
});
