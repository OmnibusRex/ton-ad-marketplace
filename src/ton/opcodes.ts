/** Keep in lockstep with `contracts/escrow.fc`. */
export const TON_ESCROW_OP = {
  deposit: 1,
  release: 2,
  refund: 3,
} as const;

export const TON_ESCROW_STATUS = {
  locked: 1,
  released: 2,
  refunded: 3,
} as const;
