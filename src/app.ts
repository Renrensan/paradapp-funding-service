import { config } from "dotenv";
config();

import "reflect-metadata";
import { registerDependencies } from "./container";

export async function bootstrap() {
  registerDependencies();
}

bootstrap();
