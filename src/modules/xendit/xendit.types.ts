import { GetPayouts200ResponseDataInner } from "xendit-node/payout/models";
import { PaymentRequestDTO, PayoutDTO } from "./dto/payment-request.dto";

export interface IXenditService {
  createPaymentRequest(dto: PaymentRequestDTO): Promise<void>;
  checkXenditPaymentStatus(paymentRequestId: string): Promise<PaymentRequest | null>;
  getBalance():any
  createPayout(dto: PayoutDTO): Promise<GetPayouts200ResponseDataInner>
}
