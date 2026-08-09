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
 * The publishing module projects this connection into a business-scoped
 * Facebook target through `FacebookTargetBridgeService`. The target carries
 * only an opaque SocialConnection reference; `FacebookService.publishPost`,
 * `publishTextForUser`, and `publishPhotoForUser` resolve the encrypted Page
 * token server-side for the approved dispatch. There is no second Facebook
 * OAuth or token source for the Facebook-only publishing path.
 */
@Module({
  imports: [MailModule],
  controllers: [FacebookController],
  providers: [FacebookService, EncryptionService],
  exports: [FacebookService],
})
export class FacebookModule {}
