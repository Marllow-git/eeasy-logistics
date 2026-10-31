// Fixture: permitted. Delivery imports WMS only through modules/wms/public (ADR-0026).
import type { StockPort } from '../wms/public/index.js';

export type DeliveryStockReader = StockPort;
