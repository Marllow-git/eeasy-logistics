'use client';

import { client, hooks, type Account } from '@eeasy-logistics/contracts/platform';
import { Can, DisabledWithReason } from '@eeasy-logistics/ui/authz';
import { Button } from '@eeasy-logistics/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@eeasy-logistics/ui/components/card';
import { Input } from '@eeasy-logistics/ui/components/input';
import { Label } from '@eeasy-logistics/ui/components/label';
import { ReasonDialog } from '@eeasy-logistics/ui/components/reason-dialog';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { bodyReasonMax } from '../support/reason-store';
import { useSupportReason } from '../support/support-reason';
import { isStale } from './parts';

// The account's lifecycle (WEB-4 plan 2.5, §7 #1; PLAT-13 2.7 and L-3; design references:
// Tailscale and Zendesk for suspend, Workable for reactivate): Suspend from `active`, Reactivate
// from `suspended`, Close from `suspended` or `provisioned` (permanent: the name typed to
// confirm). Each takes its own body reason (5 to 500), prefilled with the tab's support reason.
// An action the state does not allow is shown disabled with why; a `409 invalid_transition` from
// a stale page says so and reads the account again. For `platform.accounts.suspend`.

type Action = 'suspend' | 'reactivate' | 'close';

const allowedFrom: Record<Action, readonly Account['status'][]> = {
  suspend: ['active'],
  reactivate: ['suspended'],
  close: ['suspended', 'provisioned'],
};

const door = {
  suspend: client.platformSuspendAccount,
  reactivate: client.platformReactivateAccount,
  close: client.platformCloseAccount,
} as const;

const consequenceKeys: Record<Action, readonly ('a' | 'b' | 'c')[]> = {
  suspend: ['a', 'b', 'c'],
  reactivate: ['a', 'b'],
  close: ['a', 'b', 'c'],
};

function ActionDialog({
  account,
  action,
  onDone,
  onClose,
}: {
  account: Account;
  action: Action;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('platform.account.lifecycle');
  const fetcher = useSessionFetcher();
  const queryClient = useQueryClient();
  const support = useSupportReason();
  const id = useId();
  const [typed, setTyped] = useState('');
  const name = account.name ?? '';
  const key = hooks.getPlatformGetAccountQueryKey(account.id);
  return (
    <ReasonDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t(`${action}.title`, { name })}
      consequences={consequenceKeys[action].map((line) =>
        // Reactivate has two lines; the keys above list only those that exist.
        t(`${action}.consequences.${line}` as 'suspend.consequences.a'),
      )}
      confirmLabel={t(`${action}.confirm`)}
      tone={action === 'reactivate' ? 'primary' : 'danger'}
      max={bodyReasonMax}
      initialReason={support.reason}
      ready={action !== 'close' || typed.trim() === name.trim()}
      describeError={(error) => {
        if (!isStale(error)) return undefined;
        void queryClient.invalidateQueries({ queryKey: key });
        return t('conflict');
      }}
      onConfirm={async (reason, idempotencyKey) => {
        const answer = await door[action](
          account.id,
          { reason },
          { fetcher, headers: { 'Idempotency-Key': idempotencyKey } },
        );
        if (answer.status !== 200) throw new Error(`${action} answered ${answer.status}`);
        queryClient.setQueryData(key, answer);
        void queryClient.invalidateQueries({
          queryKey: hooks.getPlatformListAccountAuditQueryKey(account.id),
        });
        onDone(t(`${action}.done`));
      }}
    >
      {action === 'close' ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-name`}>{t('close.type_name')}</Label>
          <Input
            id={`${id}-name`}
            dir="auto"
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
      ) : null}
    </ReasonDialog>
  );
}

export function Lifecycle({ account }: { account: Account }) {
  const t = useTranslations('platform.account.lifecycle');
  const [action, setAction] = useState<Action | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (account.status === 'closed') return null;
  const button = (which: Action) => {
    const control = (
      <Button
        variant={which === 'reactivate' ? 'secondary' : 'danger'}
        onClick={() => setAction(which)}
      >
        {t(`${which}.button`)}
      </Button>
    );
    return allowedFrom[which].includes(account.status) ? (
      <span key={which}>{control}</span>
    ) : (
      <DisabledWithReason key={which} reason={t(`not_allowed.${which}`)}>
        {control}
      </DisabledWithReason>
    );
  };
  return (
    <Can permission="platform.accounts.suspend">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {(['suspend', 'reactivate', 'close'] as const).map(button)}
          </div>
          <p role="status" className="text-sm text-foreground empty:hidden">
            {done}
          </p>
          {action === null ? null : (
            <ActionDialog
              account={account}
              action={action}
              onClose={() => setAction(null)}
              onDone={(message) => {
                setAction(null);
                setDone(message);
              }}
            />
          )}
        </CardContent>
      </Card>
    </Can>
  );
}
