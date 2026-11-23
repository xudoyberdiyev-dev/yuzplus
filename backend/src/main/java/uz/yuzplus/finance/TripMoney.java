package uz.yuzplus.finance;

import uz.yuzplus.shared.money.Money;
import uz.yuzplus.shared.security.Actor;

/**
 * Reys avansi va yo'l xarajatlari — finance modulining ochiq API'si (HD2, SPEC 5.4). Hammasi kassa operatsiyasi (KO), chaqiruvchi
 * tranzaksiyasida: avans berildi — KO chiqim «Haydovchiga avans», qaytdi — KO kirim «Haydovchi avansi qaytdi» (ikkalasi manba ADVANCE,
 * xarajat/daromad hisobotiga kirmaydi); tasdiqlangan yo'l xarajati — KO chiqim mos modda bilan (manba TRIP_EXPENSE, xarajat hisobotiga kiradi).
 * Bunday KO qo'lda bekor qilinmaydi.
 */
public interface TripMoney {

    /** Yo'l xarajati turi (trip_expense.kind). */
    enum Kind { FUEL, MEAL, TOLL, REPAIR, OTHER }

    record Posted(long id, String number) {}

    /** Kassir haydovchiga avans beradi (kassa hisobi, kassir biriktirilgan bo'lishi shart). */
    Posted issueAdvance(Actor actor, long branchId, long accountId, long driverId, String tripNumber, Money amount, String note);

    /** Naqd qabulida: reys avansi kassaga qaytdi (hisob-kitob). */
    Posted returnAdvance(Actor actor, long branchId, long accountId, long driverId, String tripNumber, Money amount);

    /** Naqd qabulida: tasdiqlangan yo'l xarajati. */
    Posted expense(Actor actor, long branchId, long accountId, long driverId, String tripNumber, Kind kind, Money amount, String note);
}
