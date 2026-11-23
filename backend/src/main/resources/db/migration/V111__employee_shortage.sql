-- KT1 (egasi 23.11.2026, SPEC 5.4): haydovchi naqdini kam/ortiq qabul qilish.
-- Kassir sanagan summa kutilgandan kam bo'lsa farq sababi tanlanadi: (a) «Mijoz to'lamagan» — bekat(lar) cash_collected
-- kamayadi, farq mijoz qarzida qoladi; (b) «Haydovchi kamomadi» — mijozlar to'lovi to'liq, farq xodim kamomadi jurnaliga.
-- Ortiqcha — tanlangan bekat mijoziga to'lov/avans.

-- Reys bo'yicha qabul: taqsimot (mavjud yozuvlar uchun NOT VALID — eski qabullar avvalgi qoida bilan yozilgan)
ALTER TABLE trip_cash_accept
    ADD COLUMN unpaid NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (unpaid >= 0),
    ADD COLUMN shortage NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (shortage >= 0),
    ADD COLUMN overage_stop_id BIGINT REFERENCES trip_stop (id);
ALTER TABLE trip_cash_accept ADD CONSTRAINT trip_cash_accept_split
    CHECK ((diff < 0 AND unpaid + shortage = -diff) OR (diff >= 0 AND unpaid = 0 AND shortage = 0)) NOT VALID;

-- Kassa operatsiyasi manbai: kamomad (KO chiqim — haydovchidan olinmagan naqd; KO kirim — qaytarildi).
-- Bunday KO xarajat/daromad hisobotlariga kirmaydi va qo'lda bekor qilinmaydi.
ALTER TABLE cash_op DROP CONSTRAINT cash_op_source_check;
ALTER TABLE cash_op ADD CONSTRAINT cash_op_source_check CHECK (source IN ('MANUAL', 'CLOSE', 'SHORTAGE'));
INSERT INTO expense_item (direction, name, system) VALUES
    ('EXPENSE', 'Haydovchi kamomadi', true), ('INCOME', 'Haydovchi kamomadini qaytardi', true)
ON CONFLICT DO NOTHING;

-- Xodim kamomadi — faqat qo'shiladigan jurnal: SHORTAGE (+), REPAID (−, kassa kirimi bilan), WRITTEN_OFF (−, Direktor, sabab bilan)
CREATE TABLE employee_shortage (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id            BIGINT          NOT NULL REFERENCES branch (id),
    employee_id          BIGINT          NOT NULL REFERENCES employee (id),
    kind                 VARCHAR(12)     NOT NULL CHECK (kind IN ('SHORTAGE', 'REPAID', 'WRITTEN_OFF')),
    amount               NUMERIC(18, 2)  NOT NULL CHECK (amount > 0),
    trip_id              BIGINT          REFERENCES trip (id),
    trip_cash_accept_id  BIGINT          REFERENCES trip_cash_accept (id),
    cash_op_id           BIGINT          REFERENCES cash_op (id),
    note                 VARCHAR(300),
    created_by           BIGINT          NOT NULL REFERENCES employee (id),
    created_at           TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CHECK (kind <> 'SHORTAGE' OR (trip_id IS NOT NULL AND trip_cash_accept_id IS NOT NULL)),
    CHECK (kind <> 'REPAID' OR cash_op_id IS NOT NULL),
    CHECK (kind <> 'WRITTEN_OFF' OR (note IS NOT NULL AND btrim(note) <> ''))
);
CREATE INDEX employee_shortage_emp_idx ON employee_shortage (employee_id, branch_id, id DESC);
CREATE INDEX employee_shortage_branch_idx ON employee_shortage (branch_id, id DESC);
CREATE TRIGGER employee_shortage_append_only BEFORE UPDATE OR DELETE ON employee_shortage
    FOR EACH ROW EXECUTE FUNCTION yuzplus_forbid_modification();

-- Qoldiq (jurnal bilan bitta tranzaksiyada, FOR UPDATE): manfiy bo'lmaydi
CREATE TABLE employee_shortage_balance (
    branch_id    BIGINT          NOT NULL REFERENCES branch (id),
    employee_id  BIGINT          NOT NULL REFERENCES employee (id),
    balance      NUMERIC(18, 2)  NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at   TIMESTAMPTZ     NOT NULL DEFAULT now(),
    PRIMARY KEY (branch_id, employee_id)
);

-- Ruxsatlar: ko'rish (Direktor, Admin, Filial rahbari, Buxgalter, Kassir), hisobdan chiqarish (Direktor, Admin)
INSERT INTO permission (key, module, description, grp, kind, page) VALUES
    ('shortage.view', 'cash', 'Xodim kamomadlari: koʻrish', 'money', 'view', 'cash'),
    ('shortage.writeOff', 'cash', 'Xodim kamomadi: hisobdan chiqarish', 'money', 'special', 'cash');
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'shortage.view' FROM role r WHERE r.code IN ('DIRECTOR', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'CASHIER');
INSERT INTO role_permission_default (role_id, permission_key)
SELECT r.id, 'shortage.view' FROM role r WHERE r.system AND r.code IN ('DIRECTOR', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'CASHIER');
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'shortage.writeOff' FROM role r WHERE r.code IN ('DIRECTOR', 'ADMIN');
INSERT INTO role_permission_default (role_id, permission_key)
SELECT r.id, 'shortage.writeOff' FROM role r WHERE r.system AND r.code IN ('DIRECTOR', 'ADMIN');
