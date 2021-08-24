export class CancelledError extends Error {
  constructor(message?: string) {
    super(message);

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, CancelledError.prototype);
  }
}
