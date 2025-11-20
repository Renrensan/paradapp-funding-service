import { config } from "dotenv";
config();

import "reflect-metadata";
import { registerDependencies } from "./container";
import { TransactionProcessorModule } from "./modules/transaction-processor/transaction-processor.module";
import express from "express";

export async function bootstrap() {
  const app = express();
  app.use(express.json());

  registerDependencies(app);
  TransactionProcessorModule.init(5000, 3000);

  const port = process.env.PORT || 8080;
  app.listen(port, () => {});
}

bootstrap();
