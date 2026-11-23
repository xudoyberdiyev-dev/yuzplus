-- HD2: V114 dagi tizim moddalari foydalanuvchi qo'shgan shu nomli modda bilan to'qnashsa (ON CONFLICT DO NOTHING) — tizim belgisi qo'yiladi,
-- aks holda KO yozishda modda topilmaydi.
UPDATE expense_item SET system = true
WHERE (direction, lower(name)) IN (('EXPENSE', lower('Haydovchiga avans')), ('INCOME', lower('Haydovchi avansi qaytdi')),
                                   ('EXPENSE', lower('Haydovchi ovqatlanishi')), ('EXPENSE', lower('Yoʻl toʻlovi va parkovka')),
                                   ('EXPENSE', lower('Transport taʼmiri')))
  AND NOT system;
-- Manfiy sanalgan (kassa haydovchiga to'laydi): ortiqcha bo'lmaydi — farq ≤ 0 (kam bo'lsa (a)/(b) taqsimoti V111 tekshiruvida)
ALTER TABLE trip_cash_accept DROP CONSTRAINT trip_cash_accept_received_sign;
ALTER TABLE trip_cash_accept ADD CONSTRAINT trip_cash_accept_received_sign CHECK (received >= 0 OR diff <= 0);
