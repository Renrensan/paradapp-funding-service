import { inject, injectable } from "tsyringe";
import { PaymentRequestParameters, PaymentRequest } from "xendit-node/payment_request/models";
import { HttpResponseError } from "../../core/response/httpresponse";
import { XENDIT_TOKENS } from "./tokens";
import { PaymentRequestDTO, PayoutDTO } from "./dto/payment-request.dto";
import { CreatePayoutRequest, DigitalPayoutChannelProperties, GetPayouts200ResponseDataInner } from "xendit-node/payout/models";

@injectable()
export class XenditService {
  constructor(
    @inject(XENDIT_TOKENS.PaymentRequestClient) private paymentRequestClient: any,
    @inject(XENDIT_TOKENS.PayoutClient) private payoutClient: any,
    @inject(XENDIT_TOKENS.BalanceClient) private balanceClient: any
  ) {}

  async createPaymentRequest(dto: PaymentRequestDTO): Promise<PaymentRequest> {
    const vaAmount = dto.virtualAccountAmount > 0 ? dto.virtualAccountAmount : dto.amount;

    const data: PaymentRequestParameters = {
      amount: vaAmount,
      currency: "IDR",
      referenceId: `ref-${Date.now()}`,
      paymentMethod: {
        virtualAccount: {
          channelCode: dto.channelCode as any,
          minAmount: dto.minPaymentAmount,
          maxAmount: dto.maxPaymentAmount,
          channelProperties: {
            customerName: dto.customerName,
            expiresAt: new Date(dto.expiresAt),
          },
        },
        type: "VIRTUAL_ACCOUNT",
        reusability: "ONE_TIME_USE",
      },
      metadata: { description: dto.description },
    };

    try {
      const response: PaymentRequest = await this.paymentRequestClient.createPaymentRequest({ data });
      return response;
    } catch (err: any) {
      const status = err.status || 500;
      const code = err.errorCode || "UNKNOWN_ERROR";

      throw new HttpResponseError(status, `got xendit error: ${code}`, err);
    }
  }

  async checkXenditPaymentStatus(paymentRequestId: string): Promise<PaymentRequest | null> {
    try {
      const response: PaymentRequest = await this.paymentRequestClient.getPaymentRequestByID({
        paymentRequestId,
      });
      return response;
    } catch (err: any) {
      const status = err.status || 500;
      const code = err.errorCode || "UNKNOWN_ERROR";

      throw new HttpResponseError(status, `got xendit error: ${code}`, err);
    }
  }

  async getBalance() {
    return await this.balanceClient.getBalance();
  }

  async createPayout(dto: PayoutDTO): Promise<GetPayouts200ResponseDataInner> {
      const channelProperties: DigitalPayoutChannelProperties = {
        accountNumber: dto.accountNumber,
        accountHolderName: dto.accountHolderName,
      };

      const data: CreatePayoutRequest = {
        referenceId: dto.referenceId || `DISB-${Date.now()}`,
        channelCode: dto.channelCode,
        channelProperties,
        amount: dto.amount,
        currency: dto.currency || "PHP",
        description: dto.description,
        metadata: dto.metadata,
      };

      try {
        const response: GetPayouts200ResponseDataInner = await this.payoutClient.createPayout({
          data,
          idempotencyKey: dto.idempotencyKey || `DISB-${Date.now()}`,
        });

        return response;
      } catch (err: any) {
        const status = err.status || 500;
        const code = err.errorCode || "UNKNOWN_ERROR";
        throw new HttpResponseError(status, `got xendit error: ${code}`, err);
      }
    }

  async getPayout(payoutId: string): Promise<GetPayouts200ResponseDataInner> {
    try {
      return await this.payoutClient.getPayoutById({ id:payoutId });
    } catch (err: any) {
      const status = err.status || 500;
      const code = err.errorCode || "UNKNOWN_ERROR";
      throw new HttpResponseError(status, `got xendit error: ${code}`, err);
    }
  }
}
