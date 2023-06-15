/** Import this module like:

       import * as Paypal from './paypalTypes';

*/

export type PayoutRequest = {
  sender_batch_header: {
    sender_batch_id: string;
    recipient_type: "EMAIL";
    email_subject: string;
    email_message: string;
  };
  items: Array<{
    amount: {
      value: string;
      currency: string;
    };
    sender_item_id: string;
    recipient_wallet: "PAYPAL";
    receiver: string;
  }>;
};

export type Link = {
  href: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  rel: string;
};

export type CreateOrderResponse = {
  id: string;
  status: string;
  links: Link[];
};

export type amountWithCurrency = {
  currency_code: "USD";
  value: string;
};

// The response is actually much much bigger than this,
// but we don't care about the other fields for now.
// We can add them later.
export type CapturePaymentResponse = {
  id: string;
  links: Link[];
  payer: unknown;
  payment_source: {
    paypal: {
      account_id: string;
      account_status: string;
      address: unknown;
      email_address: string;
      name: {
        given_name: string;
        surname: string;
      };
    };
  };
  purchase_units: Array<{
    payments: {
      captures: Array<{
        amount: amountWithCurrency;
        create_time: string;
        final_capture: boolean;
        id: string;
        links: Link[];
        seller_protection: {
          dispute_categories: [string];
          status: string;
        };
        seller_receivable_breakdown: {
          gross_amount: amountWithCurrency;
          net_amount: amountWithCurrency;
          paypal_fee: amountWithCurrency;
          status: string;
          update_time: string;
        };
      }>;
    };
    reference_id: string;
    shipping: unknown;
  }>;
  status: string;
};
