/** Import this module like:

       import * as Paypal from './paypalTypes';

*/

import { z } from "zod";

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

const Link = z.object({
  href: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  rel: z.string(),
});

export type Link = z.infer<typeof Link>;

export const CreateOrderResponse = z.object({
  id: z.string(),
  status: z.string(),
  links: z.array(Link),
});

export type CreateOrderResponse = z.infer<typeof CreateOrderResponse>;

const AmountWithCurrency = z.object({
  currency_code: z.enum(["USD"]),
  value: z.string(),
});

export type AmountWithCurrency = z.infer<typeof AmountWithCurrency>;

// The response is actually much much bigger than this,
// but we don't care about the other fields for now.
// We can add them later.
export const CapturePaymentResponse = z.object({
  id: z.string(),
  links: z.array(Link),
  payer: z.unknown(),
  payment_source: z.object({
    paypal: z.object({
      account_id: z.string(),
      account_status: z.string(),
      address: z.unknown(),
      email_address: z.string(),
      name: z.object({
        given_name: z.string(),
        surname: z.string(),
      }),
    }),
  }),
  purchase_units: z.array(
    z.object({
      payments: z.object({
        captures: z.array(
          z.object({
            id: z.string(),
            create_time: z.string(),
            update_time: z.string(),
            status: z.string(),
            final_capture: z.boolean(),
            amount: AmountWithCurrency,
            links: z.array(Link),
            seller_protection: z.object({
              dispute_categories: z.array(z.string()),
              status: z.string(),
            }),
            seller_receivable_breakdown: z.object({
              gross_amount: AmountWithCurrency,
              net_amount: AmountWithCurrency,
              paypal_fee: AmountWithCurrency,
            }),
          })
        ),
      }),
      reference_id: z.string(),
      shipping: z.unknown(),
    })
  ),
  status: z.string(),
});

export type CapturePaymentResponse = z.infer<typeof CapturePaymentResponse>;

export const GetCaptureResponse = z.object({
  id: z.string(),
  create_time: z.string(),
  update_time: z.string(),
  status: z.string(),
  final_capture: z.boolean(),
  amount: AmountWithCurrency,
  links: z.array(Link),
  payee: z.object({
    email_address: z.string(),
    merchant_id: z.string(),
  }),
  seller_protection: z.object({
    dispute_categories: z.array(z.string()),
    status: z.string(),
  }),
  seller_receivable_breakdown: z.object({
    gross_amount: AmountWithCurrency,
    net_amount: AmountWithCurrency,
    paypal_fee: AmountWithCurrency,
  }),
  supplementary_data: z.object({
    related_ids: z.record(z.string()),
  }),
});

export type GetCaptureResponse = z.infer<typeof GetCaptureResponse>;

export const RefundCaptureResponse = z.object({
  id: z.string(),
  status: z.string(),
  links: z.array(Link),
});

export type RefundCaptureResponse = z.infer<typeof RefundCaptureResponse>;
