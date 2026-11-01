import {
  ArchiveRestore,
  Ban,
  BellRing,
  CircleCheck,
  CircleDot,
  CircleMinus,
  CircleX,
  ClipboardCheck,
  Clock,
  CreditCard,
  HandCoins,
  Landmark,
  Mail,
  Package,
  RotateCcw,
  TimerOff,
  Truck,
  UserCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../cn';
import { useTranslations } from '../../intl';
import type { StatusMachine, StatusState } from '../../status';

type Look = { icon: LucideIcon; colour: string };
type Looks = { [M in StatusMachine]: Record<StatusState<M>, Look> };

// One icon, one colour token and one label per state (web §6.3: never colour alone). The class
// names are literal so Tailwind generates them; the tokens are --status-<machine>-<state> in
// tokens.css. No icon here points in a reading direction, so none mirrors (web §5).
const looks: Looks = {
  order: {
    pending: { icon: Clock, colour: 'text-(--status-order-pending)' },
    accepted: { icon: ClipboardCheck, colour: 'text-(--status-order-accepted)' },
    offered: { icon: BellRing, colour: 'text-(--status-order-offered)' },
    assigned: { icon: UserCheck, colour: 'text-(--status-order-assigned)' },
    picked_up: { icon: Package, colour: 'text-(--status-order-picked_up)' },
    out_for_delivery: { icon: Truck, colour: 'text-(--status-order-out_for_delivery)' },
    attempted: { icon: RotateCcw, colour: 'text-(--status-order-attempted)' },
    delivered: { icon: CircleCheck, colour: 'text-(--status-order-delivered)' },
    failed: { icon: CircleX, colour: 'text-(--status-order-failed)' },
    returned: { icon: ArchiveRestore, colour: 'text-(--status-order-returned)' },
    cancelled: { icon: Ban, colour: 'text-(--status-order-cancelled)' },
  },
  offer: {
    sent: { icon: Mail, colour: 'text-(--status-offer-sent)' },
    accepted: { icon: CircleCheck, colour: 'text-(--status-offer-accepted)' },
    declined: { icon: CircleX, colour: 'text-(--status-offer-declined)' },
    expired: { icon: TimerOff, colour: 'text-(--status-offer-expired)' },
    withdrawn: { icon: CircleMinus, colour: 'text-(--status-offer-withdrawn)' },
  },
  attempt: {
    open: { icon: CircleDot, colour: 'text-(--status-attempt-open)' },
    succeeded: { icon: CircleCheck, colour: 'text-(--status-attempt-succeeded)' },
    failed: { icon: CircleX, colour: 'text-(--status-attempt-failed)' },
    voided: { icon: Ban, colour: 'text-(--status-attempt-voided)' },
  },
  custody: {
    collected: { icon: Wallet, colour: 'text-(--status-custody-collected)' },
    with_cashier: { icon: HandCoins, colour: 'text-(--status-custody-with_cashier)' },
    with_bank: { icon: Landmark, colour: 'text-(--status-custody-with_bank)' },
    not_held: { icon: CreditCard, colour: 'text-(--status-custody-not_held)' },
  },
};

export function StatusChip<M extends StatusMachine>({
  machine,
  state,
  className,
}: {
  machine: M;
  state: StatusState<M>;
  className?: string;
}) {
  const t = useTranslations('common.status');
  const { icon: Icon, colour } = (looks[machine] as Record<string, Look>)[state as string]!;
  return (
    <span
      data-machine={machine}
      data-state={state}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-current bg-background px-2 py-0.5 text-xs font-semibold',
        colour,
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {t(`${machine}.${state}` as Parameters<typeof t>[0])}
    </span>
  );
}
