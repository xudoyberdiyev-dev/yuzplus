package uz.yuzplus.shared.excel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import uz.yuzplus.shared.error.YuzplusException;

class ExcelUploadGuardTest {

    @Test
    void oddiyXlsxOtadiVaPoiOqiydi() throws IOException {
        byte[] xlsx;
        try (XSSFWorkbook wb = new XSSFWorkbook();
                ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            wb.createSheet("A").createRow(0).createCell(0).setCellValue("Paratsetamol");
            wb.write(out);
            xlsx = out.toByteArray();
        }
        try (Workbook wb = WorkbookFactory.create(ExcelUploadGuard.check(new ByteArrayInputStream(xlsx)))) {
            assertThat(wb.getSheetAt(0).getRow(0).getCell(0).getStringCellValue()).isEqualTo("Paratsetamol");
        }
    }

    @Test
    void zipBolmaganFaylOzgarmaydi() throws IOException {
        byte[] csv = "kod;nomi\n1;Analgin\n".getBytes(StandardCharsets.UTF_8);
        assertThat(ExcelUploadGuard.check(new ByteArrayInputStream(csv)).readAllBytes()).isEqualTo(csv);
    }

    @Test
    void ochilganHajmiKattaFaylRadEtiladi() throws IOException {
        // 101 MB nol — siqilganda ~100 KB («zip bomba» yoki 2 mln qatorli varaq kabi)
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes)) {
            zip.putNextEntry(new ZipEntry("xl/worksheets/sheet1.xml"));
            byte[] chunk = new byte[1024 * 1024];
            for (int i = 0; i < 101; i++) {
                zip.write(chunk);
            }
            zip.closeEntry();
        }
        byte[] data = bytes.toByteArray();
        assertThat(data.length).isLessThan(1024 * 1024);

        assertThatThrownBy(() -> ExcelUploadGuard.check(new ByteArrayInputStream(data)))
                .isInstanceOfSatisfying(YuzplusException.class, e -> {
                    assertThat(e.code()).isEqualTo("import.tooLarge");
                    assertThat(e.args()).containsExactly(100L);
                });
    }

    @Test
    void yozuvlarSoniKopBolsaRadEtiladi() throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes)) {
            for (int i = 0; i <= ExcelUploadGuard.MAX_ENTRIES; i++) {
                zip.putNextEntry(new ZipEntry("x/" + i));
                zip.closeEntry();
            }
        }
        byte[] data = bytes.toByteArray();
        assertThatThrownBy(() -> ExcelUploadGuard.check(new ByteArrayInputStream(data)))
                .isInstanceOf(YuzplusException.class)
                .hasMessage("import.tooLarge");
    }
}
