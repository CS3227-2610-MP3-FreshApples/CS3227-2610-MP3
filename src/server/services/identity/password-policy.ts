import "server-only";

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;

/** The canonical password policy shared by user registration and Admin bootstrap. */
export function validatePassword(password: string): boolean {
  const length = Array.from(password).length;
  return (
    length >= PASSWORD_MIN &&
    length <= PASSWORD_MAX &&
    /\p{N}/u.test(password) &&
    /[^\p{L}\p{N}\s]/u.test(password)
  );
}
