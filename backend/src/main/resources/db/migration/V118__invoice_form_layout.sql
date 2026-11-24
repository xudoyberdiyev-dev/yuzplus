-- FT (egasi tasdigʻi 24.11.2026): faktura tahriri — ustunlarni yashirish, qatorlarni olib tashlash, boʻlimlar, qoʻshilgan ustunlar va
-- mijoz + faktura turi boʻyicha shablon. Hammasi FAQAT faylga taʼsir qiladi (buyurtma, qoldiq, qarz oʻzgarmaydi).

-- Qator turi: ROW — mahsulot qatori, SECTION — boʻlim sarlavhasi (name = boʻlim nomi; ostidagi qatorlar keyingi SECTION gacha).
-- removed — «Fakturadan olib tashlangan» (oynada pastda, faylga chiqmaydi). extra — qoʻshilgan ustunlar kataklari {"x1": "Aksiya"}.
ALTER TABLE order_invoice_edit_row
    ADD COLUMN kind    VARCHAR(10) NOT NULL DEFAULT 'ROW' CHECK (kind IN ('ROW', 'SECTION')),
    ADD COLUMN removed BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN extra   JSONB;

-- extra_columns — [{"key":"x1","title":"Изоҳ"}]; hidden — faktura turi boʻyicha yashirilgan ustunlar {"CLIENT1": ["series", "price"]}.
ALTER TABLE order_invoice_edit
    ADD COLUMN extra_columns JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN hidden        JSONB NOT NULL DEFAULT '{}';

-- FT5: shablon — mijoz + faktura turi. sections — [{"title":"ДОРИ ВОСИТАЛАРИ","products":["Paratsetamol 500 mg №10", …]}].
CREATE TABLE invoice_form_template (
    customer_id   BIGINT       NOT NULL REFERENCES counterparty (id),
    form_type     VARCHAR(20)  NOT NULL CHECK (form_type IN ('WAREHOUSE', 'WAREHOUSE2', 'CLIENT_SEND', 'CLIENT1', 'CLIENT2')),
    hidden        JSONB        NOT NULL DEFAULT '[]',
    extra_columns JSONB        NOT NULL DEFAULT '[]',
    sections      JSONB        NOT NULL DEFAULT '[]',
    updated_by    BIGINT       NOT NULL REFERENCES employee (id),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (customer_id, form_type)
);
