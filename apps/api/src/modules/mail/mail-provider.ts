export const MAIL_PROVIDER = Symbol("MAIL_PROVIDER");

export type MailProviderName = "mock" | "smtp";

export interface MailProvider {
  send(to: string, subject: string, html: string): Promise<void>;
}