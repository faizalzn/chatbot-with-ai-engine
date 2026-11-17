/** Kesalahan yang pesannya aman dan layak ditampilkan langsung ke pengguna dashboard. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}
