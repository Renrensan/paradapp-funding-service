import { container } from "tsyringe";
import { INDODAX_TOKENS } from "./tokens";
import { IndodaxService } from "./indodax.service";

export function registerIndodaxModule(apiKey: string, secret: string) {
  // Register API key & secret in the container
  container.registerInstance(INDODAX_TOKENS.INDODAX_API_KEY, apiKey);
  container.registerInstance(INDODAX_TOKENS.INDODAX_SECRET, secret);

  // Register the service singleton
  container.registerSingleton(INDODAX_TOKENS.INDODAX_SERVICE, IndodaxService);
}
