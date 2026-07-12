export const MAIL_PROVIDER = Symbol("MAIL_PROVIDER");

export type MailProviderName = "mock" | "brevo";

export interface MailProvider {
  send(to: string, subject: string, html: string): Promise<void>;
}
