import { Module } from "@nestjs/common";

import { MailModule } from "../mail/mail.module";
import { EncryptionService } from "./encryption.service";
import { FacebookController } from "./facebook.controller";
import { FacebookService } from "./facebook.service";

/**
 * Facebook Page connection module (one Page per user, dev milestone).
 *
 * Provides the OAuth connect flow (`/auth/facebook/start` + `/callback`),
 * connection status (`GET /connections`), the test post
 * (`POST /connections/facebook/test`), disconnect
 * (`DELETE /connections/facebook`), and the shared `publishPost` logic used
 * by any future scheduled publishing. Token validity is checked reactively at
 * publish/test time; Graph error 190 invalidates the connection and emails
 * the owner.
 *
 * ## Relationship with the Publishing module
 *
 * The `publishing` module (`MetaGraphClient`, `MetaConnectionService`)
 * handles the Meta OAuth flow for connecting Instagram accounts and Facebook
 * Page targets through the full `PublicationCandidateV1` pipeline. This
 * `FacebookModule` is the dev-milestone direct-connection path: it connects
 * exactly one Facebook Page per user, stores the Page access token
 * reversibly encrypted, and exposes `FacebookService.publishPost()` as a
 * shared lower-level block that both the test route and future
 * scheduled-publishing code can call.
 *
 * Longer-term the Facebook-specific parts of `MetaGraphClient` should
 * delegate to `FacebookService.publishPost()` so the single PostgreSQL-backed
 * SocialConnection row is the canonical truth for the owner's connected
 * Facebook Page, and the vault in the publishing module becomes responsible
 * for Instagram tokens and multi-Page credentials only.
 */
@Module({
  imports: [MailModule],
  controllers: [FacebookController],
  providers: [FacebookService, EncryptionService],
  exports: [FacebookService],
})
export class FacebookModule {}
