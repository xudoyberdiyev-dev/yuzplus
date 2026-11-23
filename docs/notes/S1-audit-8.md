# S1 8-qism — fon vazifalar va tranzaksiya chegaralari (23.11.2026, ertalabki oyna)

Koʻrib chiqildi: barcha `@Scheduled` vazifalar (6 ta) va ularning ijrochisi, xatolarni qayd qilish, maʼlumot oʻsganda xatti-harakati.

| # | Vazifa | Topilma | Xavf | Tuzatish |
|---|---|---|---|---|
| 1 | `ReceiptReminders` (har kuni 08:00) | YB **saldosi** > 0 boʻlsa, toʻlov kuni oʻtgan **barcha** oʻtkazilgan kirimlar har kuni «Toʻlov kuni kechikdi» deb eslatilardi — FIFO boʻyicha allaqachon toʻlangan eski kirimlar ham (YT toʻlovlari hujjatga taqsimlanmaydi). 3–4 yilda faol YB uchun yuzlab soxta bildirishnoma/kun va har kirimga alohida saldo soʻrovi (N+1). | YUQORI (foydalanuvchi uchun shovqin, maʼlumot bilan oʻsadi) | `PartyLedger.remainingDebts` — hujjatning FIFO dan keyingi qoldigʻi (`creditState` bilan bir xil qoida), kontragent boʻyicha bir marta; toʻlangan kirim eslatilmaydi, summa — **qolgan** qarz. IT `paidReceiptIsNotRemindedWhileOtherDebtRemains`. |
| 2 | Ijrochi | Spring standarti — **bitta oqim**. Kunlik vazifalar uzoq ishlasa, real vaqt ulanishlarining 25 s «ping»i kechikadi → proksi SSE ulanishlarini uzadi. | Oʻrta | `SchedulerConfig`: 3 oqimli `taskScheduler` (bean — kontekst yopilganda toʻxtaydi). |
| 3 | Xatolar | Vazifa yiqilsa — faqat log; «Tizim holati» va kunlik Telegram xulosasida koʻrinmasdi. | Oʻrta | Xato `system_error` ga (`SCHEDULED`, «Klass.metod»). Unit `SchedulerConfigTest`. |
| 4 | `TripReminders`, `ExpectedReceiptReminders`, `SystemErrors.dailySummary`, `Messages.dropOrphanFiles`, SSE ping | Soʻrovlar faol holatlar boʻyicha cheklangan (hajm bilan oʻsmaydi); takrorlar `dedup_key` bilan bloklangan. | Past | — |
| 5 | Bir nechta server nusxasi | Hozir Railway'da bitta nusxa. Ikki nusxada: bildirishnomalar `dedup_key` tufayli takrorlanmaydi, lekin Telegram xato xulosasi ikki marta ketadi. | Past | Gorizontal kengaytirishda — ShedLock yoki `pg_try_advisory_lock` (hozir kerak emas). |

Tranzaksiya chegaralari: har eslatma vazifasi bitta `@Transactional` — oʻqish + bildirishnoma yozish; tashqi chaqiruv (Telegram) tranzaksiyadan tashqarida. Oʻzgartirish talab qilinmadi.
