import { IsIn, IsString, Length } from "class-validator";

const PRICE_CODES = [
  "growth_monthly_v1",
  "growth_yearly_v1",
  "growth_founding_monthly_v1",
] as const;

const PAYMENT_MODES = [
  "recurring_card",
  "one_time_card",
  "wallet",
  "reference",
] as const;

export class CreateCheckoutDto {
  @IsIn(PRICE_CODES)
  price_code!: (typeof PRICE_CODES)[number];

  @IsIn(PAYMENT_MODES)
  payment_mode!: (typeof PAYMENT_MODES)[number];

  @IsString()
  @Length(16, 128)
  idempotency_key!: string;
}
