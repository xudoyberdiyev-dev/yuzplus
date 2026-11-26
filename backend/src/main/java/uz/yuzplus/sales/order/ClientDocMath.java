package uz.yuzplus.sales.order;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/**
 * FT6 — mijoz hujjatlari (hisob varaq-faktura, tijorat taklifi, spetsifikatsiya) hisob-kitobi. Sof funksiyalar, faqat {@link BigDecimal},
 * HALF_UP, 2 xona.
 *
 * <p>Tizimda narx QQS bilan saqlanadi (SPEC 2), qarz = soni × narx. Hujjat esa QQSsiz narxdan tuziladi (namuna 1478): shuning uchun
 * <ul>
 *   <li>«Soʻmma QQS b-n» = soni × buyurtmadagi narx — qarz bilan tiyinigacha bir xil;</li>
 *   <li>«QQS soʻmma» = shu summa × stavka ÷ (100 + stavka) — sotuvdagi QQS bilan bir xil usul ({@code OrderSales});</li>
 *   <li>«Jami soʻmma» = ikkisining farqi; «Sotish narxi» = narx ÷ (1 + stavka); «Baza narxi» = kirim narxi ÷ (1 + stavka);</li>
 *   <li>«Ust.%» — nominal ustama: eng qisqa foiz (butun, 1 xona, 2 xona), qaysi bilan baza × (1 + %) sotish narxini aniqligida beradi
 *       (namunada 490 → 564 «15,00», chunki 490 × 1,15 = 563,5 → 564);</li>
 *   <li>tijorat taklifidagi «Narxi» — buyurtmadagi narx (QQS bilan).</li>
 * </ul>
 */
final class ClientDocMath {

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    private ClientDocMath() {}

    /** Kirish: soni, buyurtmadagi narx (QQS bilan), QQS stavkasi (%, ozod — 0), kirim narxi (QQS bilan, bo'lmasa {@code null}). */
    record In(long qty, BigDecimal price, BigDecimal vatRate, BigDecimal cost) {}

    /** Hujjat qatori. {@code base} va {@code markup} — kirim narxi noma'lum bo'lsa {@code null}. */
    record Line(long qty, BigDecimal base, BigDecimal markup, BigDecimal sell, BigDecimal net, BigDecimal vatRate, BigDecimal vat,
            BigDecimal gross, BigDecimal offerPrice) {

        boolean vatFree() {
            return vatRate.signum() == 0;
        }
    }

    record Totals(BigDecimal net, BigDecimal vat, BigDecimal gross) {}

    static Line line(In in) {
        BigDecimal rate = in.vatRate() == null ? BigDecimal.ZERO : in.vatRate();
        BigDecimal price = money(in.price());
        BigDecimal gross = money(price.multiply(BigDecimal.valueOf(in.qty())));
        BigDecimal vat = rate.signum() == 0 ? money(BigDecimal.ZERO) : gross.multiply(rate).divide(HUNDRED.add(rate), 2, RoundingMode.HALF_UP);
        BigDecimal net = gross.subtract(vat);
        BigDecimal sell = withoutVat(price, rate);
        BigDecimal base = in.cost() == null ? null : withoutVat(in.cost(), rate);
        BigDecimal markup = base == null ? null : markup(base, sell);
        return new Line(in.qty(), base, markup, sell, net, rate, vat, gross, price);
    }

    static Totals totals(List<Line> lines) {
        BigDecimal net = money(BigDecimal.ZERO);
        BigDecimal vat = money(BigDecimal.ZERO);
        BigDecimal gross = money(BigDecimal.ZERO);
        for (Line l : lines) {
            net = net.add(l.net());
            vat = vat.add(l.vat());
            gross = gross.add(l.gross());
        }
        return new Totals(net, vat, gross);
    }

    /** QQSsiz narx: narx × 100 ÷ (100 + stavka), 2 xona. */
    static BigDecimal withoutVat(BigDecimal amount, BigDecimal rate) {
        if (rate.signum() == 0) {
            return money(amount);
        }
        return amount.multiply(HUNDRED).divide(HUNDRED.add(rate), 2, RoundingMode.HALF_UP);
    }

    /**
     * Nominal ustama, 2 xona: avval butun foiz, keyin 1 va 2 xonali foiz sinanadi — {@code baza × (1 + %/100)} sotish narxining aniqligida
     * (butun soʻm bo'lsa — soʻmgacha, aks holda tiyingacha) HALF_UP bilan yaxlitlanganda sotish narxiga teng bo'lsa, o'sha foiz. Hech biri
     * mos kelmasa — haqiqiy foiz {@code (sotish ÷ baza − 1) × 100}. Baza 0 bo'lsa — {@code null}.
     */
    static BigDecimal markup(BigDecimal base, BigDecimal sell) {
        if (base.signum() <= 0) {
            return null;
        }
        BigDecimal exact = sell.divide(base, 12, RoundingMode.HALF_UP).subtract(BigDecimal.ONE).multiply(HUNDRED);
        int sellScale = sell.stripTrailingZeros().scale() <= 0 ? 0 : 2;
        for (int scale = 0; scale <= 2; scale++) {
            BigDecimal p = exact.setScale(scale, RoundingMode.HALF_UP);
            BigDecimal step = BigDecimal.ONE.movePointLeft(scale);
            for (BigDecimal candidate : List.of(p, p.subtract(step), p.add(step))) {
                BigDecimal priced = base.multiply(BigDecimal.ONE.add(candidate.divide(HUNDRED))).setScale(sellScale, RoundingMode.HALF_UP);
                if (priced.compareTo(sell) == 0) {
                    return candidate.setScale(2, RoundingMode.HALF_UP);
                }
            }
        }
        return exact.setScale(2, RoundingMode.HALF_UP);
    }

    /** Soʻz bilan, bosh harf bilan; 0 tiyin bo'lsa tiyin yozilmaydi (namuna: «Yetmish besh million … soʻm»). */
    static String words(BigDecimal amount) {
        String w = uz.yuzplus.shared.money.MoneyWords.of(new uz.yuzplus.shared.money.Money(amount));
        if (w.endsWith(" 00 tiyin")) {
            w = w.substring(0, w.length() - " 00 tiyin".length());
        }
        return w.isEmpty() ? w : Character.toUpperCase(w.charAt(0)) + w.substring(1);
    }

    private static BigDecimal money(BigDecimal v) {
        return v.setScale(2, RoundingMode.HALF_UP);
    }
}
