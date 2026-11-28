type AccountDeletionFailure = {
  code?: unknown;
  message?: unknown;
};

export function getAccountDeletionFailure(error: unknown) {
  const record = typeof error === 'object' && error !== null
    ? error as AccountDeletionFailure
    : null;
  const code = typeof record?.code === 'string' ? record.code : '';
  const message = typeof record?.message === 'string' ? record.message : '';

  if (message === 'ACCOUNT_DELETION_BLOCKED_ACTIVE_ORDERS') {
    return {
      status: 409,
      message: 'Complete or cancel your active orders before deleting your account.',
    };
  }
  if (message === 'ACCOUNT_DELETION_BLOCKED_UNSETTLED_FUNDS') {
    return {
      status: 409,
      message: 'Settle your pending payouts, cash remittances, or refunds before deleting your account.',
    };
  }
  if (message === 'ACCOUNT_DELETION_ADMIN_RESTRICTED' && code === '42501') {
    return {
      status: 403,
      message: 'Administrator accounts must be managed by a super administrator.',
    };
  }
  if (message === 'ACCOUNT_NOT_FOUND') {
    return {
      status: 404,
      message: 'The account could not be found. Sign in again and retry.',
    };
  }
  return null;
}
