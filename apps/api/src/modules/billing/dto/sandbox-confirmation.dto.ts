import { IsIn, IsString, Length } from "class-validator";

export class SandboxConfirmationDto {
  @IsString()
  @Length(10, 200)
  provider_checkout_ref!: string;

  @IsIn(["paid", "failed", "pending"])
  outcome!: "paid" | "failed" | "pending";
}
