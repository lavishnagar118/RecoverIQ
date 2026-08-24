export const recoveryActions = [
  "RETRY_PAYMENT",
  "SEND_REMINDER",
  "CREATE_PAYMENT_LINK",
  "OFFER_DISCOUNT",
  "STOP"
] as const;

export type RecoveryAction = (typeof recoveryActions)[number];
