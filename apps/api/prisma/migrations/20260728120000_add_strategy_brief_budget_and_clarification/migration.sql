-- AlterTable
-- Add optional external budget amount/range (in EGP) to strategy briefs.
-- Stored as JSONB to support either a single number or a { min_egp, max_egp } range.
ALTER TABLE "strategy_briefs" ADD COLUMN "external_budget_egp" JSONB;

-- AlterTable
-- Add optional clarification answers for Strategy-only questions posed
-- during brief setup. Stored as JSONB array of { question_id, question_text, answer_text, answered_at }.
ALTER TABLE "strategy_briefs" ADD COLUMN "clarification_answers" JSONB;