import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from "class-validator";

/** Owner decision for one immutable Optimization proposal. */
export class DecideOptimizationProposalDto {
  @IsIn(["approve", "dismiss"])
  action!: "approve" | "dismiss";

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  evidence_checksum!: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 256)
  idempotency_key!: string;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  note?: string | null;
}
