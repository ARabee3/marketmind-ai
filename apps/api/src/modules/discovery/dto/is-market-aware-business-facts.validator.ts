import { ValidatorConstraint, type ValidatorConstraintInterface } from "class-validator";
import { isMarketAwareBusinessFacts } from "../ai-client/ai-discovery-response.parser";

@ValidatorConstraint({ name: "isMarketAwareBusinessFacts", async: false })
export class IsMarketAwareBusinessFactsConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown): boolean {
    return isMarketAwareBusinessFacts(value);
  }

  defaultMessage(): string {
    return "confirmed_facts must match the market-aware business facts shape";
  }
}
