import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";

import { PrismaService } from "../../common/persistence/prisma.service";
import { MailDeliveryError } from "./mail-delivery.error";
import { MAIL_PROVIDER, MailProvider } from "./mail-provider";
import { MailService } from "./mail.service";

const createMockMailProvider = (): jest.Mocked<MailProvider> => ({
  send: jest.fn(),
});

const createConfigService = (): ConfigService =>
  ({
    get: jest.fn((path: string) =>
      path === "mail.appUrl" ? "http://localhost:3000" : undefined,
    ),
  }) as unknown as ConfigService;

const createPrismaService = (): PrismaService =>
  ({
    user: {
      findUnique: jest.fn().mockResolvedValue({
        email: "user@example.com",
        preferredLocale: "en",
      }),
    },
  }) as unknown as PrismaService;

describe("MailService", () => {
  let service: MailService;
  let provider: jest.Mocked<MailProvider>;

  beforeEach(async () => {
    provider = createMockMailProvider();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: MAIL_PROVIDER, useValue: provider },
        { provide: ConfigService, useValue: createConfigService() },
        { provide: PrismaService, useValue: createPrismaService() },
      ],
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

  describe("sendFacebookExpiredEmail", () => {
    it("sends the reconnect email with the connections URL", async () => {
      provider.send.mockResolvedValue(undefined);
      const prisma = createPrismaService();

      const module = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: MAIL_PROVIDER, useValue: provider },
          { provide: ConfigService, useValue: createConfigService() },
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      const mailService = module.get<MailService>(MailService);

      await mailService.sendFacebookExpiredEmail("user-1");

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-1" },
        select: { email: true, preferredLocale: true },
      });
      expect(provider.send).toHaveBeenCalledTimes(1);
      const [to, subject, html] = provider.send.mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(to).toBe("user@example.com");
      expect(subject).toContain("expired");
      expect(html).toContain("http://localhost:3000/connections");
    });

    it("skips sending when the user does not exist", async () => {
      const prisma = createPrismaService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const module = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: MAIL_PROVIDER, useValue: provider },
          { provide: ConfigService, useValue: createConfigService() },
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      const mailService = module.get<MailService>(MailService);

      await mailService.sendFacebookExpiredEmail("missing-user");

      expect(provider.send).not.toHaveBeenCalled();
    });

    it("does not throw when mail delivery fails", async () => {
      provider.send.mockRejectedValue(new Error("SMTP down"));
      const prisma = createPrismaService();

      const module = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: MAIL_PROVIDER, useValue: provider },
          { provide: ConfigService, useValue: createConfigService() },
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      const mailService = module.get<MailService>(MailService);

      await expect(
        mailService.sendFacebookExpiredEmail("user-1"),
      ).resolves.toBeUndefined();
    });
  });

  describe("sendBillingPaymentConfirmation", () => {
    const input = {
      ownerUserId: "user-1",
      bundleNameEn: "Starter",
      bundleNameAr: "مبتدئ",
      pointsGranted: 150,
      amountEgp: 100,
      currency: "EGP",
      transactionRef: "tx-1",
      confirmedAt: new Date("2026-08-20T10:00:00.000Z"),
    };

    it("sends a localized English confirmation with the billing link", async () => {
      provider.send.mockResolvedValue(undefined);
      const prisma = createPrismaService();

      const module = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: MAIL_PROVIDER, useValue: provider },
          { provide: ConfigService, useValue: createConfigService() },
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      const mailService = module.get<MailService>(MailService);

      await mailService.sendBillingPaymentConfirmation(input);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-1" },
        select: { email: true, preferredLocale: true },
      });
      expect(provider.send).toHaveBeenCalledTimes(1);
      const [to, subject, html] = provider.send.mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(to).toBe("user@example.com");
      expect(subject).toBe("Your points have been added");
      expect(html).toContain("Starter");
      expect(html).toContain("150");
      expect(html).toContain("tx-1");
      expect(html).toContain("http://localhost:3000/billing");
    });

    it("renders Arabic for an ar-EG preferred locale", async () => {
      provider.send.mockResolvedValue(undefined);
      const prisma = createPrismaService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        email: "user@example.com",
        preferredLocale: "ar-EG",
      });

      const module = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: MAIL_PROVIDER, useValue: provider },
          { provide: ConfigService, useValue: createConfigService() },
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      const mailService = module.get<MailService>(MailService);

      await mailService.sendBillingPaymentConfirmation(input);

      const [to, subject, html] = provider.send.mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(subject).toBe("تمت إضافة نقاطك");
      expect(html).toContain("مبتدئ");
      expect(html).toContain('dir="rtl"');
    });

    it("throws when the owner user does not exist so the outbox retries", async () => {
      const prisma = createPrismaService();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const module = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: MAIL_PROVIDER, useValue: provider },
          { provide: ConfigService, useValue: createConfigService() },
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      const mailService = module.get<MailService>(MailService);

      await expect(
        mailService.sendBillingPaymentConfirmation(input),
      ).rejects.toBeInstanceOf(MailDeliveryError);
      expect(provider.send).not.toHaveBeenCalled();
    });

    it("propagates provider failures so the outbox worker can retry", async () => {
      provider.send.mockRejectedValue(new MailDeliveryError("SMTP down"));
      const prisma = createPrismaService();

      const module = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: MAIL_PROVIDER, useValue: provider },
          { provide: ConfigService, useValue: createConfigService() },
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      const mailService = module.get<MailService>(MailService);

      await expect(
        mailService.sendBillingPaymentConfirmation(input),
      ).rejects.toBeInstanceOf(MailDeliveryError);
    });
  });
});
