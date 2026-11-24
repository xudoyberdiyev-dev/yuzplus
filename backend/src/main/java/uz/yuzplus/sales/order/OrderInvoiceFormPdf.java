package uz.yuzplus.sales.order;

import java.math.BigDecimal;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import uz.yuzplus.shared.error.YuzplusException;
import uz.yuzplus.shared.pdf.PdfDocument;
import uz.yuzplus.shared.pdf.PdfFormat;
import uz.yuzplus.shared.pdf.PdfRenderer;
import uz.yuzplus.shared.security.Actor;

/** O18: 5 xil fakturaning PDF varianti (Excel bilan bir xil ustunlar va tuzatishlar); ommaviy — har buyurtma yangi sahifadan. */
@Service
class OrderInvoiceFormPdf {

    private static final DateTimeFormatter DMY = DateTimeFormatter.ofPattern("dd.MM.yyyy");

    private final OrderInvoiceForms forms;
    private final PdfRenderer pdf;

    OrderInvoiceFormPdf(OrderInvoiceForms forms, PdfRenderer pdf) {
        this.forms = forms;
        this.pdf = pdf;
    }

    @Transactional(readOnly = true)
    PdfDocument render(Actor actor, List<Long> ids, OrderInvoiceForms.FormType type, boolean prices, boolean fefo) {
        if (type.priced && !prices) {
            throw YuzplusException.forbidden("invoiceForms.noPrices");
        }
        List<Long> unique = ids == null ? List.of() : ids.stream().distinct().toList();
        if (unique.isEmpty() || unique.size() > OrderInvoiceForms.MAX_BULK) {
            throw YuzplusException.badRequest("order.invoiceBulkSize", OrderInvoiceForms.MAX_BULK);
        }
        List<Map<String, Object>> docs = new ArrayList<>();
        String first = null;
        for (Long id : unique) {
            OrderInvoiceForms.InvoiceForms f = forms.get(actor, id, prices, false, fefo && type.warehouse(), type);
            if (first == null) {
                first = f.orderNumber();
            }
            docs.add(doc(f, type));
        }
        Map<String, Object> vars = new HashMap<>();
        vars.put("title", type.title);
        vars.put("docs", docs);
        String name = "faktura-" + type.name().toLowerCase(java.util.Locale.ROOT) + "-"
                + (unique.size() == 1 ? first.replaceAll("[^A-Za-z0-9-]", "") : String.valueOf(unique.size()));
        return new PdfDocument(name, pdf.render("invoice-form", vars));
    }

    private static boolean right(String key) {
        return key.equals("no") || key.equals("qty") || key.equals("price") || key.equals("total");
    }

    private static Map<String, Object> cell(String v, boolean right, String cls, int span) {
        return Map.of("v", v == null ? "" : v, "right", right, "cls", cls, "span", span);
    }

    /** FT: yashirilgan ustunlar va olib tashlangan qatorlar chiqmaydi; boʻlim — sarlavha qatori + «Бўлим жами»; jami qayta hisoblanadi. */
    static Map<String, Object> doc(OrderInvoiceForms.InvoiceForms f, OrderInvoiceForms.FormType type) {
        List<OrderInvoiceForms.PrintColumn> columns = OrderInvoiceForms.printColumns(f, type);
        OrderInvoiceForms.PrintBody body = OrderInvoiceForms.printBody(f, type);
        int qtyCol = OrderInvoiceForms.indexOf(columns, "qty");
        int sumCol = type.priced ? OrderInvoiceForms.indexOf(columns, "total") : -1;
        List<Map<String, Object>> rows = new ArrayList<>();
        for (OrderInvoiceForms.PrintLine pl : body.lines()) {
            List<Map<String, Object>> cells = new ArrayList<>();
            if ("SECTION".equals(pl.kind())) {
                cells.add(cell(pl.title(), false, "", columns.size()));
                rows.add(Map.of("cls", "sec", "cells", cells));
                continue;
            }
            if ("SUBTOTAL".equals(pl.kind())) {
                rows.add(Map.of("cls", "sub", "cells", totalCells(columns, pl.title(), qtyCol, pl.qty(), sumCol, pl.sum())));
                continue;
            }
            OrderInvoiceForms.FormRow x = pl.row();
            for (OrderInvoiceForms.PrintColumn col : columns) {
                String v = switch (col.key()) {
                    case "no" -> String.valueOf(pl.no());
                    case "qty" -> PdfFormat.qty(x.qty());
                    case "price" -> x.price() == null ? "" : PdfFormat.money(x.price());
                    case "total" -> x.total() == null ? "" : PdfFormat.money(x.total());
                    default -> OrderInvoiceForms.cellText(x, col.key());
                };
                String cls = (col.key().equals("series") || col.key().equals("expiry")) && x.batchHint() != null ? "hint"
                        : col.key().equals("series") && x.shortage() != null ? "miss" : "";
                cells.add(cell(v, right(col.key()), cls, 1));
            }
            rows.add(Map.of("cls", "", "cells", cells));
        }
        rows.add(Map.of("cls", "tot", "cells", totalCells(columns, "Жами", qtyCol, body.qty(), sumCol, body.sum())));
        Map<String, Object> m = new HashMap<>();
        m.put("number", "Буюртма № " + f.orderNumber() + " · " + DMY.format(f.date()));
        m.put("customer", "Мижоз: " + f.customer() + (f.tin() == null ? "" : " · СТИР " + f.tin()));
        m.put("warehouse", "Омбор: " + f.warehouse());
        m.put("note", f.fefo() && f.rows().stream().anyMatch(x -> x.batchHint() != null || x.shortage() != null) ? OrderInvoiceForms.FEFO_NOTE : "");
        m.put("columns", columns.stream().map(c -> Map.<String, Object>of("name", c.title(), "right", right(c.key()))).toList());
        m.put("rows", rows);
        return m;
    }

    private static List<Map<String, Object>> totalCells(List<OrderInvoiceForms.PrintColumn> columns, String title, int qtyCol, long qty, int sumCol,
            BigDecimal sum) {
        List<Map<String, Object>> cells = new ArrayList<>();
        for (int i = 0; i < columns.size(); i++) {
            String v = i == 0 ? title : i == qtyCol ? PdfFormat.qty(qty)
                    : i == sumCol ? PdfFormat.money(sum.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString()) : "";
            cells.add(cell(v, right(columns.get(i).key()), "", 1));
        }
        return cells;
    }
}
