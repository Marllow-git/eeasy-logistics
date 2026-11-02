import { Redirect, type Href } from 'expo-router';
import type { Gate } from '../src/domain/gate';
import { useGate } from '../src/ui/use-driver';

const targets: Record<Exclude<Gate, 'loading'>, Href> = {
  update: '/update',
  auth: '/sign-in',
  'setup-pin': '/pin',
  'setup-permissions': '/permissions',
  app: '/home',
};

/**
 * The entry route (driver app §9): sends the driver to the first screen of the group the gate
 * allows. The protected groups fall back here whenever the gate moves (sign-in, PIN, sign-out).
 */
export default function Entry() {
  const gate = useGate();
  if (gate === 'loading') return null;
  return <Redirect href={targets[gate]} />;
}
