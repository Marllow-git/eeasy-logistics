import { Stack } from 'expo-router';

/** Screens without a session: sign-in and OTP (driver app §9). Empty until DRV orders add them. */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
