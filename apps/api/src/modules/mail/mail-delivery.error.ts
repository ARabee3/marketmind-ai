export class MailDeliveryError extends Error {
  public readonly code = "MAIL_DELIVERY_FAILED";

  constructor(message?: string) {
    super(message ?? "Failed to send email");
    this.name = "MailDeliveryError";
  }
}
