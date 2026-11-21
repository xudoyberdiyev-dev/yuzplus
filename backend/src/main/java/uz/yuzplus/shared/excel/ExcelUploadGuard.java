package uz.yuzplus.shared.excel;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipInputStream;
import uz.yuzplus.shared.error.YuzplusException;

/**
 * Yuklangan .xlsx faylni Apache POI ga berishdan oldin ochilgan hajmini tekshiradi.
 *
 * <p>POI .xlsx ni to'liq xotiraga (DOM) o'qiydi: 20 MB siqilgan fayl ichida yuzlab MB XML bo'lishi
 * mumkin (masalan, 2 mln qatorli varaq yoki «zip bomba») — bitta shunday yuklash butun backend xotirasini
 * (heap 1,5 GB) tugatib, barcha foydalanuvchilar uchun xizmatni to'xtatadi (S1 audit). Haqiqiy importlar
 * (≤ 20 000 qator) bu chegaradan ancha kichik.
 *
 * <p>Fayl .xlsx (zip) bo'lmasa (.xls, buzilgan fayl) — o'zgartirmay qaytariladi, xatoni POI beradi.
 */
public final class ExcelUploadGuard {

    /** Barcha zip yozuvlarining ochilgan umumiy hajmi chegarasi. */
    public static final long MAX_UNPACKED_BYTES = 100L * 1024 * 1024;

    /** Zip ichidagi yozuvlar soni chegarasi (oddiy .xlsx da o'nlab). */
    public static final int MAX_ENTRIES = 2_000;

    private ExcelUploadGuard() {}

    /**
     * Oqimni to'liq o'qiydi, .xlsx bo'lsa ochilgan hajmini haqiqiy ochib sanaydi (sarlavhadagi hajmga
     * ishonmaydi) va o'qish uchun yangi oqim qaytaradi.
     *
     * @throws YuzplusException {@code import.tooLarge} — chegaradan oshsa
     */
    public static InputStream check(InputStream in) throws IOException {
        byte[] data = in.readAllBytes();
        if (isZip(data)) {
            checkUnpacked(data);
        }
        return new ByteArrayInputStream(data);
    }

    private static boolean isZip(byte[] data) {
        return data.length >= 4 && data[0] == 'P' && data[1] == 'K' && data[2] == 3 && data[3] == 4;
    }

    private static void checkUnpacked(byte[] data) throws IOException {
        long total = 0;
        int entries = 0;
        byte[] buf = new byte[64 * 1024];
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(data))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++entries > MAX_ENTRIES) {
                    throw tooLarge();
                }
                if (entry.isDirectory()) {
                    continue;
                }
                int n;
                while ((n = zip.read(buf)) > 0) {
                    total += n;
                    if (total > MAX_UNPACKED_BYTES) {
                        throw tooLarge();
                    }
                }
            }
        } catch (ZipException e) {
            // ZipInputStream o'qiy olmaydigan (lekin POI o'qiy oladigan) tuzilma — POI ning o'z
            // himoyasi (ZipSecureFile) qoladi; buzilgan bo'lsa POI «o'qib bo'lmadi» deydi.
            return;
        }
    }

    private static YuzplusException tooLarge() {
        return YuzplusException.badRequest("import.tooLarge", MAX_UNPACKED_BYTES / (1024 * 1024));
    }
}
