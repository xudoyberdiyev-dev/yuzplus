import type { Metadata } from "next";
import QRCode from "qrcode";
import { AppDownload } from "@/features/mobile-app/app-download";
import { APK_URL } from "@/features/mobile-app/links";

export const metadata: Metadata = { title: "Haydovchi ilovasi — 100+" };

/** HD1: «100+ Haydovchi» APK ni yuklab olish sahifasi (ommaviy): QR kod va oʻrnatish yoʻriqnomasi uch tilda. */
export default async function Page() {
  const svg = await QRCode.toString(APK_URL, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  // Rang — token orqali (HEX yozilmaydi): modullar matn rangida, fon shaffof
  const qr = svg.replace(/#000000/g, "currentColor").replace(/#ffffff/g, "transparent");
  return <AppDownload qrSvg={qr} />;
}
