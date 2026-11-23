package uz.yuzplus.finance;

import uz.yuzplus.shared.money.Money;
import uz.yuzplus.shared.security.Actor;

/**
 * Xodim (haydovchi) kamomadi — finance modulining ochiq API'si (KT1, SPEC 5.4). Kassir reys naqdini kam qabul qilib, sababini
 * «Haydovchi kamomadi» deb belgilasa: mijozlar to'lovi to'liq yoziladi, kassaga tushmagan farq — KO chiqim («Haydovchi kamomadi»,
 * xarajat hisobotiga kirmaydi) va xodim kamomadi jurnaliga yoziladi; Filial rahbari va Direktorga bildirishnoma. Chaqiruvchi tranzaksiyasida.
 */
public interface DriverShortages {

    void recordTrip(Actor actor, long branchId, long employeeId, long accountId, long tripId, long acceptId, String tripNumber, Money amount, String note);
}
