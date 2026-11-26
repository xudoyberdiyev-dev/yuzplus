-- BG1 F1 (egasi qarori 26.11.2026): filial direktori va bosh hisobchisi — xodimlardan tanlanadi (rolidan qatʼi nazar).
-- Hujjatlar (yuk xati, FT6 mijoz hujjatlari, NO, dalolatnomalar) ismni shu yerdan oladi; tanlanmagan boʻlsa —
-- eski matn maydonlari (director_name / accountant_name), ular ham boʻsh boʻlsa — rol boʻyicha avtomatik.
ALTER TABLE branch
    ADD COLUMN director_employee_id   BIGINT REFERENCES employee (id),
    ADD COLUMN accountant_employee_id BIGINT REFERENCES employee (id);
COMMENT ON COLUMN branch.director_employee_id IS 'Filial rahbari (direktor) — xodim; hujjatlarda imzo qoʻyuvchi';
COMMENT ON COLUMN branch.accountant_employee_id IS 'Filial bosh hisobchisi — xodim; hujjatlarda imzo qoʻyuvchi';

-- Sozlamalar → Chop etish’da qoʻlda tanlanganlar shu ustunlarga koʻchadi (endi yagona manba — filial kartasi)
UPDATE branch b SET director_employee_id = s.head_id, accountant_employee_id = s.accountant_id
FROM print_signer s WHERE s.branch_id = b.id;
COMMENT ON TABLE print_signer IS 'ESKIRGAN (V120): imzo qoʻyuvchilar endi branch.director_employee_id / accountant_employee_id da';
