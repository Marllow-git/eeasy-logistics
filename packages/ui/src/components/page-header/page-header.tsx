import type { ReactNode } from 'react';
import { cn } from '../../cn';

/**
 * The page's one `h1`, an optional description, actions at the end edge, and an optional tab row
 * under the title for the states of the page's list (design references, docs/references/design/
 * WEB-1.md). The tab row is a `Tabs` list the page supplies.
 */
export function PageHeader({
  title,
  description,
  actions,
  tabs,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 flex flex-col gap-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {tabs ?? null}
    </header>
  );
}
