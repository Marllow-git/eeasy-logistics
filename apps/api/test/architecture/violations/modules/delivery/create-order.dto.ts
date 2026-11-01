// Violation fixture (rule no-dto-files, doc 3 §9, A-17): a hand-written DTO. Request and
// response shapes are the generated types of @eeasy-logistics/contracts.
export interface CreateOrderDto {
  readonly reference: string;
}
