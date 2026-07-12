import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { SmtpMailProvider } from "./smtp-mail.provider";
import { MailDeliveryError } from "./mail-delivery.error";

const mockSendMail = jest.fn();

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,
  })),
}));

const createConfigService = (
  options: {
    host?: string;
    port?: number;
    user?: string;
    pass?: string;
    from?: string;
  } = {},
) => {
  const defaults = {
    host: "smtp.gmail.com",
    port: 587,
    user: "team@example.com",
    pass: "app-password",
    from: "no-reply@example.com",
  };
  const merged = { ...defaults, ...options };

  return {
    get: jest.fn((key: string) => {
      if (key === "mail.smtp.host") return merged.host;
      if (key === "mail.smtp.port") return merged.port;
      if (key === "mail.smtp.user") return merged.user;
      if (key === "mail.smtp.pass") return merged.pass;
      if (key === "mail.from") return merged.from;
      return undefined;
    }),
  } as unknown as ConfigService;
};

describe("SmtpMailProvider", () => {
  beforeEach(() => {
    mockSendMail.mockReset();
  });

  afterEach(() => jest.restoreAllMocks());

  it("maps the MarketMind mail contract to a nodemailer sendMail call", async () => {
    mockSendMail.mockResolvedValue({ messageId: "message-id" });
    const provider = new SmtpMailProvider(createConfigService());

    await provider.send("owner@example.com", "Verify email", "<p>Verify</p>");

    expect(mockSendMail).toHaveBeenCalledWith({
      from: "no-reply@example.com",
      to: "owner@example.com",
      subject: "Verify email",
      html: "<p>Verify</p>",
    });
  });

  it("normalizes SMTP failures as MailDeliveryError", async () => {
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    mockSendMail.mockRejectedValue(new Error("SMTP unavailable"));
    const provider = new SmtpMailProvider(createConfigService());

    await expect(
      provider.send("owner@example.com", "Subject", "<p>body</p>"),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "MailDeliveryError",
        message: "SMTP unavailable",
      }),
    );
  });

  it("fails visibly when selected without complete SMTP configuration", async () => {
    const provider = new SmtpMailProvider(
      createConfigService({ host: "", user: "", pass: "" }),
    );

    await expect(
      provider.send("owner@example.com", "Subject", "<p>body</p>"),
    ).rejects.toBeInstanceOf(MailDeliveryError);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("fails visibly when MAIL_FROM is missing", async () => {
    const provider = new SmtpMailProvider(createConfigService({ from: "" }));

    await expect(
      provider.send("owner@example.com", "Subject", "<p>body</p>"),
    ).rejects.toBeInstanceOf(MailDeliveryError);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});