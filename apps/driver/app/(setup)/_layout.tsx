import { Stack } from 'expo-router';
import { useGate } from '../../src/ui/use-driver';

/** Screens until the cash PIN and permissions steps are done (driver app §9), in that order. */
export default function SetupLayout() {
  const gate = useGate();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={gate === 'setup-pin'}>
        <Stack.Screen name="pin" />
      </Stack.Protected>
      <Stack.Protected guard={gate === 'setup-permissions'}>
        <Stack.Screen name="permissions" />
      </Stack.Protected>
    </Stack>
  );
}
