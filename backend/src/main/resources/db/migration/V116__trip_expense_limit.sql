-- HD2: yoʻl xarajati limiti (Sozlamalar → Pul), standart 0 — oʻchiq. Oshgan xarajat kassir qabulida belgilanadi (bloklamaydi).
INSERT INTO app_setting (key, value) VALUES ('tripExpenseLimit', 0) ON CONFLICT (key) DO NOTHING;
