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

// The response is actually much much bigger than this,
// but we don't care about the other fields for now.
// We can add them later.
export type CapturePaymentResponse = {
  payment_source: { paypal: { email_address: string } };
};
