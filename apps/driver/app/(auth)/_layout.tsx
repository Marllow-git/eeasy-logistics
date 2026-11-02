import { Stack } from 'expo-router';

/** Screens without a session (driver app §9): sign-in, the code, and the account picker as a sheet. */
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="verify" />
      <Stack.Screen
        name="account"
        options={{
          presentation: 'formSheet',
          sheetGrabberVisible: true,
          sheetAllowedDetents: [0.6, 1],
        }}
      />
    </Stack>
  );
}
