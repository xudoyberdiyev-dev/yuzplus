package uz.yuzplus.sales.order;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** FT6: mijoz hujjatlari hisobi — egasi namunasi (1478) bilan tiyinigacha. */
class ClientDocMathTest {

    private static final BigDecimal VAT = new BigDecimal("12");

    /** Namuna: soni, baza (QQSsiz), sotish (QQSsiz), jami, QQS, QQS bilan. */
    private static final String[][] SAMPLE = {
        {"600", "2361.00", "2715.00", "1629000.00", "195480.00", "1824480.00"},
        {"300", "7314.00", "8411.00", "2523300.00", "302796.00", "2826096.00"},
        {"20", "10200.00", "11730.00", "234600.00", "28152.00", "262752.00"},
        {"20", "10200.00", "11730.00", "234600.00", "28152.00", "262752.00"},
        {"50", "10200.00", "11730.00", "586500.00", "70380.00", "656880.00"},
        {"50", "10200.00", "11730.00", "586500.00", "70380.00", "656880.00"},
        {"100", "4600.00", "5290.00", "529000.00", "63480.00", "592480.00"},
        {"150", "4600.00", "5290.00", "793500.00", "95220.00", "888720.00"},
        {"150", "4600.00", "5290.00", "793500.00", "95220.00", "888720.00"},
        {"100", "4600.00", "5290.00", "529000.00", "63480.00", "592480.00"},
        {"50", "15900.00", "18285.00", "914250.00", "109710.00", "1023960.00"},
        {"50", "15900.00", "18285.00", "914250.00", "109710.00", "1023960.00"},
        {"50", "15900.00", "18285.00", "914250.00", "109710.00", "1023960.00"},
        {"200", "8102.68", "9318.00", "1863600.00", "223632.00", "2087232.00"},
        {"50", "23608.00", "27149.00", "1357450.00", "162894.00", "1520344.00"},
        {"1000", "682.00", "784.00", "784000.00", "94080.00", "878080.00"},
        {"10000", "2841.00", "3267.00", "32670000.00", "3920400.00", "36590400.00"},
        {"4950", "1400.00", "1610.00", "7969500.00", "956340.00", "8925840.00"},
        {"100", "4600.00", "5290.00", "529000.00", "63480.00", "592480.00"},
        {"100", "4600.00", "5290.00", "529000.00", "63480.00", "592480.00"},
        {"25", "12800.00", "14720.00", "368000.00", "44160.00", "412160.00"},
        {"25", "12800.00", "14720.00", "368000.00", "44160.00", "412160.00"},
        {"6000", "490.00", "564.00", "3384000.00", "406080.00", "3790080.00"},
        {"600", "931.00", "1071.00", "642600.00", "77112.00", "719712.00"},
        {"8000", "330.00", "380.00", "3040000.00", "364800.00", "3404800.00"},
        {"7200", "300.00", "345.00", "2484000.00", "298080.00", "2782080.00"},
    };

    private static BigDecimal withVat(String net) {
        return new BigDecimal(net).multiply(new BigDecimal("1.12")).setScale(2, java.math.RoundingMode.HALF_UP);
    }

    @Test
    void ownerSampleToTheTiyin() {
        List<ClientDocMath.Line> lines = new ArrayList<>();
        for (String[] s : SAMPLE) {
            ClientDocMath.Line l = ClientDocMath.line(new ClientDocMath.In(Long.parseLong(s[0]), withVat(s[2]), VAT, withVat(s[1])));
            assertThat(l.base()).isEqualTo(s[1]);
            assertThat(l.markup()).isEqualTo("15.00");
            assertThat(l.sell()).isEqualTo(s[2]);
            assertThat(l.net()).isEqualTo(s[3]);
            assertThat(l.vat()).isEqualTo(s[4]);
            assertThat(l.gross()).isEqualTo(s[5]);
            assertThat(l.offerPrice()).isEqualTo(withVat(s[2]));
            lines.add(l);
        }
        ClientDocMath.Totals t = ClientDocMath.totals(lines);
        assertThat(t.net()).isEqualTo("67171400.00");
        assertThat(t.vat()).isEqualTo("8060568.00");
        assertThat(t.gross()).isEqualTo("75231968.00");
        assertThat(ClientDocMath.words(t.gross())).isEqualTo("Yetmish besh million ikki yuz oʻttiz bir ming toʻqqiz yuz oltmish sakkiz soʻm");
        // Tijorat taklifi: 2 715 × 1,12 = 3 040,80; 8 411 × 1,12 = 9 420,32
        assertThat(lines.get(0).offerPrice()).isEqualTo("3040.80");
        assertThat(lines.get(1).offerPrice()).isEqualTo("9420.32");
    }

    @Test
    void nominalMarkup() {
        // 490 × 1,15 = 563,5 → 564: haqiqiy 15,10 %, lekin narx 15 % ustamadan — «15,00»
        assertThat(ClientDocMath.markup(new BigDecimal("490.00"), new BigDecimal("564.00"))).isEqualTo("15.00");
        assertThat(ClientDocMath.markup(new BigDecimal("8102.68"), new BigDecimal("9318.00"))).isEqualTo("15.00");
        // Qo'lda qo'yilgan narx — haqiqiy foiz: 100 → 112,34 = 12,34 %
        assertThat(ClientDocMath.markup(new BigDecimal("100.00"), new BigDecimal("112.34"))).isEqualTo("12.34");
        assertThat(ClientDocMath.markup(new BigDecimal("100.00"), new BigDecimal("112.50"))).isEqualTo("12.50");
        // 300 → 301: 0,3 % ustama 300,9 → 301 beradi — eng qisqa foiz
        assertThat(ClientDocMath.markup(new BigDecimal("300.00"), new BigDecimal("301.00"))).isEqualTo("0.30");
        // Zararga sotish — manfiy
        assertThat(ClientDocMath.markup(new BigDecimal("200.00"), new BigDecimal("180.00"))).isEqualTo("-10.00");
        assertThat(ClientDocMath.markup(BigDecimal.ZERO, new BigDecimal("10.00"))).isNull();
    }

    @Test
    void vatFreeAndUnknownCost() {
        ClientDocMath.Line l = ClientDocMath.line(new ClientDocMath.In(3, new BigDecimal("132"), BigDecimal.ZERO, new BigDecimal("110")));
        assertThat(l.vatFree()).isTrue();
        assertThat(l.vat()).isEqualTo("0.00");
        assertThat(l.net()).isEqualTo("396.00");
        assertThat(l.gross()).isEqualTo("396.00");
        assertThat(l.markup()).isEqualTo("20.00");
        ClientDocMath.Line n = ClientDocMath.line(new ClientDocMath.In(1, new BigDecimal("100"), VAT, null));
        assertThat(n.base()).isNull();
        assertThat(n.markup()).isNull();
        // QQS narx ichida: 100 × 12 / 112 = 10,71; jami 89,29
        assertThat(n.vat()).isEqualTo("10.71");
        assertThat(n.net()).isEqualTo("89.29");
        assertThat(n.sell()).isEqualTo("89.29");
    }

    @Test
    void wordsAndDates() {
        assertThat(ClientDocMath.words(new BigDecimal("1001.05"))).isEqualTo("Bir ming bir soʻm 05 tiyin");
        assertThat(ClientDocMath.words(new BigDecimal("396.00"))).isEqualTo("Uch yuz toʻqson olti soʻm");
        assertThat(ClientDocs.date(LocalDate.of(2026, 11, 26), 2026)).isEqualTo("«26» noyabr 2026 yil");
        assertThat(ClientDocs.date(LocalDate.of(2026, 1, 5), 2026)).isEqualTo("«05» yanvar 2026 yil");
        assertThat(ClientDocs.date(null, 2026)).isEqualTo("«___» ______ 2026 yil");
        assertThat(ClientDocs.weightedCost(List.of(new long[] {2, 10000}, new long[] {1, 13000}))).isEqualTo("110.00");
        assertThat(ClientDocs.weightedCost(List.of())).isNull();
    }
}
