import { Module } from "@nestjs/common";
import { AuditService } from "./audit.service";

/**
 * Append-only audit infrastructure. Exported so any admin controller can
 * call `AuditService.record(...)` for sensitive mutations.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}