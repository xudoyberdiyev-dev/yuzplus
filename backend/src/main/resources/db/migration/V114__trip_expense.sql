-- HD2 (egasi 23.11.2026, SPEC 5.4): yo'l xarajatlari va reys avansi.
-- Avans: kassir haydovchiga reysdan oldin (yoki yo'lda) naqd beradi — KO chiqim «Haydovchiga avans» (manba ADVANCE, xarajat hisobotiga kirmaydi).
-- Xarajat: haydovchi mobil ilovada yozadi (yoqilg'ida chek rasmi majburiy). Kassir naqd qabulida har birini tasdiqlaydi / rad etadi.
-- Qabulda kutilgan summa = bekatlar naqdi + ochiq avanslar − tasdiqlangan xarajatlar (manfiy bo'lsa kassa haydovchiga to'laydi).
-- Qabul paytida: avans qaytdi — KO kirim (ADVANCE), har tasdiqlangan xarajat — KO chiqim mos modda bilan (TRIP_EXPENSE, P&L ga kiradi).

ALTER TABLE cash_op DROP CONSTRAINT cash_op_source_check;
ALTER TABLE cash_op ADD CONSTRAINT cash_op_source_check CHECK (source IN ('MANUAL', 'CLOSE', 'SHORTAGE', 'ADVANCE', 'TRIP_EXPENSE'));
INSERT INTO expense_item (direction, name, system) VALUES
    ('EXPENSE', 'Haydovchiga avans', true), ('INCOME', 'Haydovchi avansi qaytdi', true),
    ('EXPENSE', 'Haydovchi ovqatlanishi', true), ('EXPENSE', 'Yoʻl toʻlovi va parkovka', true),
    ('EXPENSE', 'Transport taʼmiri', true)
ON CONFLICT DO NOTHING;

-- Qabul: avans va tasdiqlangan xarajatlar ham hisobga olinadi — kutilgan summa 0 yoki manfiy bo'lishi mumkin
ALTER TABLE trip_cash_accept DROP CONSTRAINT trip_cash_accept_expected_check;
ALTER TABLE trip_cash_accept DROP CONSTRAINT trip_cash_accept_received_check;
ALTER TABLE trip_cash_accept
    ADD COLUMN advance NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (advance >= 0),
    ADD COLUMN expenses NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (expenses >= 0);
-- Kassir haydovchiga to'lasa (manfiy) — aynan kutilgan summa; aks holda sanagan summa ≥ 0
ALTER TABLE trip_cash_accept ADD CONSTRAINT trip_cash_accept_received_sign CHECK (received >= 0 OR received = expected);

CREATE TABLE trip_advance (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trip_id     BIGINT          NOT NULL REFERENCES trip (id),
    amount      NUMERIC(18, 2)  NOT NULL CHECK (amount > 0),
    cash_op_id  BIGINT          NOT NULL REFERENCES cash_op (id),
    note        VARCHAR(300),
    created_by  BIGINT          NOT NULL REFERENCES employee (id),
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),
    accept_id   BIGINT          REFERENCES trip_cash_accept (id)
);
CREATE INDEX trip_advance_trip_idx ON trip_advance (trip_id);
CREATE INDEX trip_advance_open_idx ON trip_advance (trip_id) WHERE accept_id IS NULL;

CREATE TABLE trip_expense (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trip_id       BIGINT          NOT NULL REFERENCES trip (id),
    kind          VARCHAR(10)     NOT NULL CHECK (kind IN ('FUEL', 'MEAL', 'TOLL', 'REPAIR', 'OTHER')),
    amount        NUMERIC(18, 2)  NOT NULL CHECK (amount > 0),
    source        VARCHAR(10)     NOT NULL CHECK (source IN ('ADVANCE', 'OWN', 'COLLECTED')),
    note          VARCHAR(300),
    liters        NUMERIC(10, 2)  CHECK (liters IS NULL OR liters > 0),
    price         NUMERIC(18, 2)  CHECK (price IS NULL OR price > 0),
    odometer      INTEGER         CHECK (odometer IS NULL OR odometer >= 0),
    lat           NUMERIC(9, 6)   CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
    lng           NUMERIC(9, 6)   CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
    spent_at      TIMESTAMPTZ     NOT NULL,
    client_uuid   UUID            UNIQUE,
    status        VARCHAR(10)     NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reject_reason VARCHAR(300),
    decided_by    BIGINT          REFERENCES employee (id),
    decided_at    TIMESTAMPTZ,
    accept_id     BIGINT          REFERENCES trip_cash_accept (id),
    cash_op_id    BIGINT          REFERENCES cash_op (id),
    created_by    BIGINT          NOT NULL REFERENCES employee (id),
    created_at    TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CHECK (kind <> 'OTHER' OR (note IS NOT NULL AND btrim(note) <> '')),
    CHECK (status <> 'REJECTED' OR (reject_reason IS NOT NULL AND btrim(reject_reason) <> '')),
    CHECK (status = 'PENDING' OR (decided_by IS NOT NULL AND accept_id IS NOT NULL)),
    CHECK (status <> 'APPROVED' OR cash_op_id IS NOT NULL)
);
CREATE INDEX trip_expense_trip_idx ON trip_expense (trip_id);
CREATE INDEX trip_expense_spent_idx ON trip_expense (spent_at DESC);

-- Chek rasmi (yoqilg'ida majburiy — xizmat tekshiradi)
CREATE TABLE trip_expense_photo (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    expense_id    BIGINT        NOT NULL REFERENCES trip_expense (id),
    content_type  VARCHAR(40)   NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    size_bytes    INTEGER       NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
    data          BYTEA         NOT NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX trip_expense_photo_idx ON trip_expense_photo (expense_id);

-- Hal qilingan (qabulga kirgan) xarajat o'zgarmaydi; avans qabulga kirgach o'zgarmaydi; o'chirish yo'q
CREATE FUNCTION yuzplus_trip_expense_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' OR OLD.accept_id IS NOT NULL THEN
        RAISE EXCEPTION 'Yoʻl xarajati / avans qabul qilingan — oʻzgartirib boʻlmaydi (faqat qoʻshiladi)';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trip_expense_guard BEFORE UPDATE OR DELETE ON trip_expense FOR EACH ROW EXECUTE FUNCTION yuzplus_trip_expense_guard();
CREATE TRIGGER trip_advance_guard BEFORE UPDATE OR DELETE ON trip_advance FOR EACH ROW EXECUTE FUNCTION yuzplus_trip_expense_guard();

-- Ko'rish: «Yo'l xarajatlari» sahifasi (Direktor, Admin, Filial rahbari, Buxgalter, Kassir)
INSERT INTO permission (key, module, description, grp, kind, page) VALUES
    ('tripExpenses.view', 'cash', 'Yoʻl xarajatlari: koʻrish va hisobot', 'money', 'view', 'cash');
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'tripExpenses.view' FROM role r WHERE r.code IN ('DIRECTOR', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'CASHIER');
INSERT INTO role_permission_default (role_id, permission_key)
SELECT r.id, 'tripExpenses.view' FROM role r WHERE r.system AND r.code IN ('DIRECTOR', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'CASHIER');
