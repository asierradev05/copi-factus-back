export class FactusApiException extends Error {
  constructor(
    readonly statusCode: number,
    readonly messages: string[],
    readonly raw: unknown,
  ) {
    super(messages.join('; '));
    this.name = 'FactusApiException';
  }

  isAlreadyExists(): boolean {
    return this.messages.some((m) => /already exists|ya existe/i.test(m));
  }
}
