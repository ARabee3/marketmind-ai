import { IsIn, IsString, Length } from "class-validator";

const BUNDLE_CODES = [
  "starter_150",
  "growth_300",
  "pro_500",
] as const;

const PAYMENT_MODES = [
  "one_time_card",
  "wallet",
  "reference",
] as const;

export class CreateCheckoutDto {
  @IsIn(BUNDLE_CODES)
  bundle_code!: (typeof BUNDLE_CODES)[number];

  @IsIn(PAYMENT_MODES)
  payment_mode!: (typeof PAYMENT_MODES)[number];

  @IsString()
  @Length(16, 128)
  idempotency_key!: string;
}
