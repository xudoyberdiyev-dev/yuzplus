-- BG1 B1 (egasi 26.11.2026): qoldiqdagi partiyaning raqami, ishlab chiqarilgan sanasi va yaroqlilik muddatini tahrirlash.
-- Partiya jadvali qoʻshiladigan (append-only) edi; endi FAQAT shu uch maydon, FAQAT servis orqali (sessiya belgisi
-- yuzplus.batch_edit = on) oʻzgaradi — mahsulot, tannarx, bonus, manba oʻzgarmaydi, oʻchirish taqiqlangan.
-- Oʻtkazilgan hujjatlar (kirim qatori, boshlangʻich qoldiq va h.k.) oʻz nusxasini saqlaydi — ular oʻzgarmaydi.
CREATE FUNCTION yuzplus_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'batch: o''chirish taqiqlangan' USING ERRCODE = 'check_violation';
    END IF;
    IF coalesce(current_setting('yuzplus.batch_edit', true), '') <> 'on'
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.cost IS DISTINCT FROM OLD.cost
       OR NEW.bonus IS DISTINCT FROM OLD.bonus
       OR NEW.source_type IS DISTINCT FROM OLD.source_type
       OR NEW.source_id IS DISTINCT FROM OLD.source_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'batch: faqat raqam, ishlab chiqarilgan sana va yaroqlilik muddati tahrirlanadi' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER batch_append_only ON batch;
CREATE TRIGGER batch_guard BEFORE UPDATE OR DELETE ON batch FOR EACH ROW EXECUTE FUNCTION yuzplus_batch_guard();

CREATE TABLE batch_edit (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id     BIGINT       NOT NULL REFERENCES batch (id),
    branch_id    BIGINT       REFERENCES branch (id),
    old_number   VARCHAR(64)  NOT NULL,
    new_number   VARCHAR(64)  NOT NULL,
    old_produced DATE,
    new_produced DATE,
    old_expiry   DATE         NOT NULL,
    new_expiry   DATE         NOT NULL,
    reason       VARCHAR(300) NOT NULL CHECK (btrim(reason) <> ''),
    employee_id  BIGINT       REFERENCES employee (id),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX batch_edit_batch_idx ON batch_edit (batch_id, created_at DESC);
COMMENT ON TABLE batch_edit IS 'BG1 B1: partiya maʼlumotini tahrirlash tarixi (sabab majburiy); faqat qoʻshiladi';
CREATE TRIGGER batch_edit_append_only BEFORE UPDATE OR DELETE ON batch_edit
    FOR EACH ROW EXECUTE FUNCTION yuzplus_forbid_modification();

INSERT INTO permission (key, module, description, grp, kind, page) VALUES
    ('stock.batchEdit', 'stock', 'Qoldiq: partiya raqami va yaroqlilik muddatini tahrirlash (sabab bilan)', 'wh', 'special', 'stock');
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'stock.batchEdit' FROM role r WHERE r.code IN ('DIRECTOR', 'WAREHOUSE_MANAGER');
INSERT INTO role_permission_default (role_id, permission_key)
SELECT r.id, 'stock.batchEdit' FROM role r WHERE r.system AND r.code IN ('DIRECTOR', 'WAREHOUSE_MANAGER');
