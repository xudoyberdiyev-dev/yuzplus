-- FT6 (egasi 26.11.2026): mijoz hujjatlari toʻplami — hisob varaq-faktura, tijorat taklifi, spetsifikatsiya.
-- Buyurtmaning mijoz shartnomasi alohida jadvalda: sales_order yakunlangach (DELIVERED) trigger bilan muzlatiladi,
-- hujjatlar esa yetkazilgandan keyin ham chiqariladi — shuning uchun shartnoma tanlovi buyurtma qatoriga emas, yonidagi jadvalga yoziladi.
CREATE TABLE sales_order_contract (
    order_id     BIGINT      PRIMARY KEY REFERENCES sales_order (id),
    contract_id  BIGINT      NOT NULL REFERENCES counterparty_contract (id),
    updated_by   BIGINT      REFERENCES employee (id),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE sales_order_contract IS 'FT6: buyurtma uchun tanlangan mijoz shartnomasi (hujjat raqami va sanasi shundan)';

-- Mijoz kartasi: gʻazna rekvizitlari (byudjet tashkilotlari uchun, ixtiyoriy)
ALTER TABLE counterparty
    ADD COLUMN treasury_account VARCHAR(27) CHECK (treasury_account ~ '^[0-9]{20,27}$'),
    ADD COLUMN treasury_tin     VARCHAR(9)  CHECK (treasury_tin ~ '^[0-9]{9}$');
COMMENT ON COLUMN counterparty.treasury_account IS 'Gʻazna hisob raqami (byudjet tashkiloti)';
COMMENT ON COLUMN counterparty.treasury_tin IS 'Gʻazna STIR';

-- Filial (yuridik shaxs): IFUT — faoliyat turi kodi
ALTER TABLE branch ADD COLUMN ifut VARCHAR(5) CHECK (ifut ~ '^[0-9]{5}$');
COMMENT ON COLUMN branch.ifut IS 'IFUT (iqtisodiy faoliyat turlari umumdavlat tasniflagichi) kodi';

-- Kirim narxi (baza narxi) chiqadigan hujjatlar — alohida ruxsat
INSERT INTO permission (key, module, description, grp, kind, page) VALUES
    ('invoices.costPrint', 'invoices', 'Mijoz hujjatlari (hisob varaq-faktura, tijorat taklifi, spetsifikatsiya) — kirim narxi bilan',
     'money', 'special', 'invoices');
INSERT INTO role_permission (role_id, permission_key)
SELECT r.id, 'invoices.costPrint' FROM role r WHERE r.code IN ('DIRECTOR', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT');
INSERT INTO role_permission_default (role_id, permission_key)
SELECT r.id, 'invoices.costPrint' FROM role r WHERE r.system AND r.code IN ('DIRECTOR', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT');
