import { Stack } from 'expo-router';

/** Root navigator. Groups gate access (driver app §9): (auth), (setup) and (app). */
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
