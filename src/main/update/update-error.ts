export type UpdateErrorRecovery = 'retry' | 'manual-download';

const SIGNATURE_VALIDATION_FAILURES = [
  /code signature.+did not pass validation/i,
  /did not satisfy.+code requirement/i,
  /代码未能满足指定的代码要求/,
  /签名.+验证失败/,
] as const;

export function updateRecoveryForError(error: Error): UpdateErrorRecovery {
  return SIGNATURE_VALIDATION_FAILURES.some((pattern) => pattern.test(error.message))
    ? 'manual-download'
    : 'retry';
}
