export interface PaymentRequestDTO {
  amount: number;
  description: string;
  channelCode: string;

  customerName: string;

  minPaymentAmount: number;
  maxPaymentAmount: number;
  virtualAccountAmount: number;

  expiresAt: string; // ISO string
}

export interface PayoutDTO {
  amount: number;
  accountNumber: string;
  accountHolderName: string;
  channelCode: string;
  description?: string;
  referenceId?: string;
  currency?: string; // default to PHP
  idempotencyKey?: string;
  metadata?: object;

}
