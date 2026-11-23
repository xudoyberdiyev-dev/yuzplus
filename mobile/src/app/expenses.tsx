import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Camera, Check, ChevronLeft, Plus, Wallet } from "lucide-react-native";
import { useT, type MessageKey } from "../i18n";
import { ApiError } from "../lib/api";
import { formatTiyin, toTiyin } from "../lib/format";
import { advanceLeft, checkDraft, defaultSource, EXPENSE_KINDS, EXPENSE_SOURCES, type ExpenseDraft, type ExpenseKind } from "../lib/expense-core";
import { enqueue, flush, isNetworkError } from "../lib/queue";
import { cashDigits, digitsToTiyin, groupDigits, tiyinToApi } from "../lib/stop-view";
import { tripMoney, type TripMoney } from "../lib/trips";
import { useAsync } from "../lib/use-async";
import { useQueueInfo } from "../lib/use-queue";
import { Card, Chip, ErrorState, Loading, Notice, SectionLabel, mono } from "../ui/blocks";
import { Button } from "../ui/parts";
import { color, font, radius, space, text } from "../ui/theme";

const EMPTY: ExpenseDraft = { kind: "FUEL", amount: 0n, source: "ADVANCE", note: "", photo: null, liters: "", price: 0n, odometer: "" };

/** Joylashuv ixtiyoriy: ruxsat boʻlsa — tezda oxirgi maʼlum nuqta. */
async function where(): Promise<{ lat: number; lng: number } | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const p = await Location.getLastKnownPositionAsync();
    return p ? { lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 } : null;
  } catch {
    return null;
  }
}

/** HD2: «Yoʻl xarajatlari» — avans qoldigʻi, yozilgan xarajatlar (holati bilan) va yangi xarajat (yoqilgʻida chek rasmi majburiy, oflayn navbat). */
export default function ExpensesScreen() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { trip } = useLocalSearchParams<{ trip: string }>();
  const tripId = Number(trip);
  const money = useAsync(() => tripMoney(tripId));
  const queue = useQueueInfo();
  const [form, setForm] = useState<ExpenseDraft | null>(null);
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (money.loading && money.data === undefined) return <Loading />;
  const data: TripMoney | undefined = money.data;
  const queued = queue.items.filter((q) => q.kind === "expense" && q.tripId === tripId);
  const advance = data ? toTiyin(data.advanceOpen) : 0n;
  const left = advanceLeft(
    advance,
    (data?.expenses ?? [])
      .filter((x) => !x.settled)
      .map((x) => ({ amount: toTiyin(x.amount), source: x.source, rejected: x.status === "REJECTED" })),
  );

  function open() {
    setForm({ ...EMPTY, source: defaultSource(left, 0n) });
    setAmount("");
    setPrice("");
    setTried(false);
    setError(null);
  }

  async function takeReceipt() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setError(t("stop.cameraDenied"));
    const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6, exif: false });
    const asset = shot.canceled ? null : shot.assets[0];
    if (asset && form) setForm({ ...form, photo: asset.uri });
  }

  const draft: ExpenseDraft | null = form ? { ...form, amount: digitsToTiyin(amount), price: digitsToTiyin(price) } : null;
  const problem = draft ? checkDraft(draft) : null;

  async function save() {
    setTried(true);
    if (!draft || problem) return;
    setBusy(true);
    setError(null);
    const at = await where();
    const body = {
      kind: draft.kind,
      amount: tiyinToApi(draft.amount) ?? "0",
      source: draft.source,
      note: draft.note.trim() || null,
      liters: draft.kind === "FUEL" && draft.liters.trim() ? draft.liters.trim().replace(",", ".") : null,
      price: draft.kind === "FUEL" ? tiyinToApi(draft.price) : null,
      odometer: draft.odometer.trim() ? Number(draft.odometer.trim()) : null,
      lat: at?.lat ?? null,
      lng: at?.lng ?? null,
      spentAt: new Date().toISOString(),
      clientUuid: Crypto.randomUUID(),
    };
    try {
      // Navbat orqali: internet yoʻq boʻlsa ham yoʻqolmaydi; bor boʻlsa darhol yuboriladi
      await enqueue({ kind: "expense", tripId, stopId: null, expense: body, uri: draft.photo });
      await flush();
      setForm(null);
      await money.reload();
    } catch (e) {
      if (!isNetworkError(e)) setError(e instanceof ApiError ? (e.problem.detail ?? t("common.loadError")) : t("common.loadError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("stop.back")} onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} strokeWidth={1.5} color={color.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          {data ? <Text style={[mono, { color: color.textSecondary, fontSize: 12 }]}>{data.tripNumber}</Text> : null}
          <Text style={text.title}>{t("exp.title")}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {money.error && !data ? <ErrorState message={t("common.loadError")} retry={() => void money.reload()} retryLabel={t("common.retry")} /> : null}
        {data ? (
          <Card>
            <View style={styles.titleRow}>
              <Wallet size={20} strokeWidth={1.5} color={color.primaryButton} />
              <Text style={text.bodyStrong}>{t("exp.advance")}</Text>
            </View>
            <Row label={t("exp.advanceGiven")} value={formatTiyin(advance)} />
            <Row label={t("exp.advanceLeft")} value={formatTiyin(left)} tone={left < 0n ? color.danger : undefined} />
            <Text style={[text.caption, { fontSize: 13 }]}>{t("exp.hint")}</Text>
          </Card>
        ) : null}

        {form ? (
          <Card accent="active">
            <SectionLabel>{t("exp.new")}</SectionLabel>
            <View style={styles.chips}>
              {EXPENSE_KINDS.map((k) => (
                <Pressable key={k} accessibilityRole="button" onPress={() => setForm({ ...form, kind: k as ExpenseKind })}>
                  <Chip label={t(`exp.kind.${k}` as MessageKey)} tone={form.kind === k ? "info" : "neutral"} icon={form.kind === k ? Check : undefined} />
                </Pressable>
              ))}
            </View>
            <Text style={text.label}>{t("exp.amount")}</Text>
            <TextInput
              value={groupDigits(amount)}
              onChangeText={(v) => {
                const d = cashDigits(v);
                setAmount(d);
                if (form.source !== "OWN") setForm({ ...form, source: defaultSource(left, digitsToTiyin(d)) });
              }}
              keyboardType="number-pad"
              style={[styles.amount, tried && problem === "amount" && { borderColor: color.danger }]}
            />
            <Text style={text.label}>{t("exp.source")}</Text>
            <View style={styles.chips}>
              {EXPENSE_SOURCES.map((s) => (
                <Pressable key={s} accessibilityRole="button" onPress={() => setForm({ ...form, source: s })}>
                  <Chip label={t(`exp.src.${s}` as MessageKey)} tone={form.source === s ? "info" : "neutral"} icon={form.source === s ? Check : undefined} />
                </Pressable>
              ))}
            </View>
            {form.kind === "FUEL" ? (
              <>
                <Pressable accessibilityRole="button" onPress={() => void takeReceipt()}>
                  <View style={[styles.task, tried && problem === "photo" && { borderColor: color.danger }]}>
                    {form.photo ? <Check size={18} strokeWidth={2} color={color.success} /> : <Camera size={18} strokeWidth={1.5} color={color.textSecondary} />}
                    <Text style={text.body}>{form.photo ? t("exp.receiptDone") : t("exp.receipt")}</Text>
                  </View>
                </Pressable>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={text.label}>{t("exp.liters")}</Text>
                    <TextInput value={form.liters} onChangeText={(v) => setForm({ ...form, liters: v })} keyboardType="decimal-pad" style={styles.input} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={text.label}>{t("exp.price")}</Text>
                    <TextInput value={groupDigits(price)} onChangeText={(v) => setPrice(cashDigits(v))} keyboardType="number-pad" style={styles.input} />
                  </View>
                </View>
              </>
            ) : null}
            <Text style={text.label}>{t("exp.odometer")}</Text>
            <TextInput value={form.odometer} onChangeText={(v) => setForm({ ...form, odometer: v.replace(/\D/g, "") })} keyboardType="number-pad" style={styles.input} />
            <Text style={text.label}>{form.kind === "OTHER" ? t("exp.noteRequired") : t("exp.note")}</Text>
            <TextInput value={form.note} onChangeText={(v) => setForm({ ...form, note: v })} maxLength={300} style={styles.input} />
            {tried && problem ? <Notice>{t(`exp.err.${problem}` as MessageKey)}</Notice> : null}
            {error ? <Notice>{error}</Notice> : null}
            <Button label={t("exp.save")} icon={Check} loading={busy} onPress={() => void save()} />
            <Pressable accessibilityRole="button" onPress={() => setForm(null)} style={styles.secondary}>
              <Text style={styles.secondaryText}>{t("exp.cancel")}</Text>
            </Pressable>
          </Card>
        ) : (
          <Button label={t("exp.add")} icon={Plus} onPress={open} />
        )}

        {queued.length > 0 ? <Notice tone="info">{t("exp.queued", { count: queued.length })}</Notice> : null}
        {data && data.expenses.length === 0 && queued.length === 0 ? <Text style={[text.caption, { fontSize: 13 }]}>{t("exp.empty")}</Text> : null}
        {data?.expenses.map((x) => (
          <Card key={x.id}>
            <View style={styles.spread}>
              <Text style={text.bodyStrong}>{t(`exp.kind.${x.kind}` as MessageKey)}</Text>
              <Text style={text.bodyStrong}>{formatTiyin(toTiyin(x.amount))}</Text>
            </View>
            <Text style={[text.caption, { fontSize: 13 }]}>
              {t(`exp.src.${x.source}` as MessageKey)}
              {x.note ? ` · ${x.note}` : ""}
              {x.kind === "FUEL" && x.photos === 0 ? ` · ${t("exp.noReceipt")}` : ""}
            </Text>
            <View style={{ flexDirection: "row" }}>
              <Chip
                label={t(`exp.st.${x.status}` as MessageKey)}
                tone={x.status === "APPROVED" ? "success" : x.status === "REJECTED" ? "danger" : "warning"}
              />
            </View>
            {x.rejectReason ? <Text style={[text.caption, { color: color.danger, fontSize: 13 }]}>{x.rejectReason}</Text> : null}
          </Card>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.spread}>
      <Text style={[text.body, { color: color.textSecondary }]}>{label}</Text>
      <Text style={[text.bodyStrong, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  body: { padding: space.lg, gap: space.md, paddingBottom: 32 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  spread: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  task: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.control,
    paddingHorizontal: 12,
  },
  amount: {
    height: 52,
    borderWidth: 1,
    borderColor: color.primary,
    borderRadius: radius.control,
    paddingHorizontal: 14,
    textAlign: "right",
    fontFamily: font.bold,
    fontSize: 22,
    color: color.textPrimary,
    backgroundColor: color.surface,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.control,
    paddingHorizontal: 12,
    fontFamily: font.regular,
    fontSize: 15,
    color: color.textPrimary,
    backgroundColor: color.surface,
  },
  secondary: {
    height: 44,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontFamily: font.semibold, fontSize: 15, color: color.textPrimary },
});
