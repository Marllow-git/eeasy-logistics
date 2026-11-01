// next-intl's request configuration (web §5): the shared one from packages/ui (plan 2.8) with this
// app's own `platform` namespace merged in (ADR-0038).
import { shellRequestConfig } from '@eeasy-logistics/ui/shell/request-config';
import { appMessages } from './messages';

export default shellRequestConfig(appMessages);
