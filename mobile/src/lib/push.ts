// HD1: push bildirishnomalar (Expo Notifications) — «yangi reys / reys oʻzgardi / kamomad». Ruxsat berilmasa yoki FCM kaliti
// sozlanmagan boʻlsa jim oʻtadi: ilova ishlayveradi, bildirishnomalar veb panelda koʻrinadi.
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";
import { readJson, writeJson } from "./queue";

const FILE = "push-token.json";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Kirgandan keyin: ruxsat soʻraladi, token serverga yoziladi. Hech qachon xato tashlamaydi. */
export async function registerPush(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", { name: "100+", importance: Notifications.AndroidImportance.HIGH });
    }
    const perm = await Notifications.getPermissionsAsync();
    const granted = perm.granted || (perm.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
    if (!granted) return;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api<void>("/api/devices", { method: "POST", body: { token, platform: Platform.OS === "ios" ? "IOS" : "ANDROID" } });
    await writeJson(FILE, { token });
  } catch {
    // push ixtiyoriy
  }
}

/** Chiqishda: server bu qurilmaga push yubormasin. */
export async function unregisterPush(): Promise<void> {
  try {
    const saved = await readJson<{ token?: string }>(FILE, {});
    if (saved.token) await api<void>("/api/devices/remove", { method: "POST", body: { token: saved.token } });
    await writeJson(FILE, {});
  } catch {
    // tarmoq yoʻq — keyingi kirishda token boshqa xodimga oʻtadi
  }
}
