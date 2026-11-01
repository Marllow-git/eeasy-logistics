// Violation fixture (rule no-dto-files, adversary L-8): a DTO named with a hyphen.
export interface CancelOrderDto {
  readonly reason: string;
}
