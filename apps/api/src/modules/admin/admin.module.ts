import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminBillingService } from "./admin-billing.service";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  controllers: [AdminController],
  providers: [AdminService, AdminBillingService],
})
export class AdminModule {}
