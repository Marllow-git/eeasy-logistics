import type { DataPoint, MetricData } from '@opentelemetry/sdk-metrics';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { Metrics } from '../../src/modules/kernel/telemetry/metrics.js';

// Test support (PLAT-14): a `Metrics` on its own meter provider, read back on demand.

class CollectingReader extends MetricReader {
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }

  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export interface CollectedPoint {
  readonly name: string;
  readonly attributes: Record<string, unknown>;
  readonly value: unknown;
}

export function testMetrics(): { metrics: Metrics; collect: () => Promise<CollectedPoint[]> } {
  const reader = new CollectingReader();
  const provider = new MeterProvider({ readers: [reader] });
  const metrics = new Metrics(provider.getMeter('elx-test'));
  const collect = async () => {
    const { resourceMetrics } = await reader.collect();
    return resourceMetrics.scopeMetrics.flatMap((scope) =>
      scope.metrics.flatMap((metric: MetricData) =>
        (metric.dataPoints as DataPoint<unknown>[]).map((point) => ({
          name: metric.descriptor.name,
          attributes: { ...point.attributes },
          value: point.value,
        })),
      ),
    );
  };
  return { metrics, collect };
}
