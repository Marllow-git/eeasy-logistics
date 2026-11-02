import { Badge } from '../components/badge/badge';
import { useTranslations } from '../intl';
import { Ban, CircleCheck, Mail, type LucideIcon } from 'lucide-react';

// The status chips of the settings lists (web §6.3: an icon and a word, never colour alone). The
// membership and site states are not among `StatusChip`'s order machines, so they live here.

const memberLooks: Record<string, { icon: LucideIcon; tone: 'success' | 'warning' | 'neutral' }> = {
  active: { icon: CircleCheck, tone: 'success' },
  invited: { icon: Mail, tone: 'warning' },
  revoked: { icon: Ban, tone: 'neutral' },
};

/** A membership's state: active, invitation sent, revoked. */
export function MemberStatusChip({ status }: { status: string | undefined }) {
  const t = useTranslations('settings.members.status');
  const key = status === 'invited' || status === 'revoked' ? status : 'active';
  const { icon: Icon, tone } = memberLooks[key]!;
  return (
    <Badge tone={tone} className="whitespace-nowrap">
      <Icon aria-hidden className="size-3.5" />
      {t(key)}
    </Badge>
  );
}

/** A role as a quiet chip. */
export function RoleChip({ role }: { role: string }) {
  const t = useTranslations('settings.roles');
  const key = role as Parameters<typeof t>[0];
  return <Badge className="whitespace-nowrap">{t.has(key) ? t(key) : role}</Badge>;
}
