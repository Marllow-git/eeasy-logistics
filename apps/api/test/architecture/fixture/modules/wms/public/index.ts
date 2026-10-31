// Fixture: a context's public port, importable by other contexts.
export interface StockPort {
  available(productId: string): Promise<number>;
}
