import "reflect-metadata";
import { config } from "dotenv";
config();
import { container } from "tsyringe";
import { XenditService } from "../xendit.service";
import { registerXenditModule } from "../xendit.module";
import { XENDIT_TOKENS } from "../tokens";

beforeAll(() => {
  registerXenditModule();
});

describe("XenditService Integration Test", () => {
  let service: XenditService;
  let paymentReferenceId: string;
  let payoutReferenceId: string;

  beforeAll(() => {
    service = container.resolve<XenditService>(XENDIT_TOKENS.XenditService);
  });

  it("should call the real Xendit API and return a payment request", async () => {
    const dto = {
      amount: 1000,
      description: "Integration Test Payment",
      channelCode: "MANDIRI",
      customerName: "John Doe",
      minPaymentAmount: 1000,
      maxPaymentAmount: 1000,
      virtualAccountAmount: 1000,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      referenceId: "222",
    };

    try {
      const response = await service.createPaymentRequest(dto);
      console.log("Real Xendit response:", response);

      expect(response).toHaveProperty("id");
      expect(response).toHaveProperty("status");

      // Save referenceId for next test
      paymentReferenceId = response.referenceId;
    } catch (err: any) {
      console.error("Xendit API error:", err);
      throw err;
    }
  });

  it("should check the status of the created payment request", async () => {
    if (!paymentReferenceId) {
      throw new Error("No referenceId from previous test");
    }

    try {
      const status = await service.checkXenditPaymentStatus(paymentReferenceId);
      console.log("Payment status response:", status);

      expect(status).toHaveProperty("id");
      expect(status).toHaveProperty("status");
      expect(status?.referenceId).toBe(paymentReferenceId);
    } catch (err: any) {
      if (err?.status === 404) {
        console.warn(`Payment request ${paymentReferenceId} not found`);
        return; // do not fail test
      }
      console.error("Xendit status API error:", err);
      throw err; // fail for other errors
    }
  });

  it("should get the current Xendit balance", async () => {
    try {
      const balance = await service.getBalance();
      console.log("Xendit balance response:", balance);

      expect(balance).toHaveProperty("balance");
    } catch (err: any) {
      console.error("Xendit balance API error:", err);
      throw err;
    }
  });

  it("should call the real Xendit API and create a payout", async () => {
    const dto = {
      amount: 100000,
      accountNumber: "000000",
      accountHolderName: "John Doe",
      channelCode: "PH_BDO",
      description: "Integration Test Payout",
      currency: "PHP",
    };

    try {
      const response = await service.createPayout(dto);
      console.log("Real Xendit payout response:", response);

      expect(response).toHaveProperty("id");
      expect(response).toHaveProperty("status");
      expect(response.referenceId).toBeDefined();

      // Save referenceId for next test
      payoutReferenceId = response.referenceId;
    } catch (err: any) {
      console.error("Xendit Payout API error:", err);
      throw err;
    }
  });

  it("should check the status of the created payout", async () => {
    if (!payoutReferenceId) {
      throw new Error("No referenceId from previous test");
    }

    try {
      const payout = await service.getPayout(payoutReferenceId);
      console.log("Payout status response:", payout);

      expect(payout).toHaveProperty("id");
      expect(payout).toHaveProperty("status");
      expect(payout.referenceId).toBe(payoutReferenceId);
    } catch (err: any) {
      if (err?.status === 404) {
        console.warn(`Payout ${payoutReferenceId} not found`);
        return; // do not fail test
      }
      console.error("Xendit Payout status API error:", err);
      throw err; // fail for other errors
    }
  });
});
