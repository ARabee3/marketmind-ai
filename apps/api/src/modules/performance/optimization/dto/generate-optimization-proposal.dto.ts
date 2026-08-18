import { IsIn, IsOptional } from "class-validator";

/** Owner action for one deterministic cohort. No business/provider IDs are client-selected. */
export class GenerateOptimizationProposalDto {
  @IsOptional()
  @IsIn(["text_post", "static_image_post"])
  format?: "text_post" | "static_image_post";
}
