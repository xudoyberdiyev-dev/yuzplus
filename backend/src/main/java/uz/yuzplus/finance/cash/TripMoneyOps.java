package uz.yuzplus.finance.cash;

import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import uz.yuzplus.finance.CashierGuard;
import uz.yuzplus.finance.TripMoney;
import uz.yuzplus.finance.account.Accounts;
import uz.yuzplus.finance.cash.CashModels.Direction;
import uz.yuzplus.finance.cash.CashModels.OpSource;
import uz.yuzplus.shared.error.YuzplusException;
import uz.yuzplus.shared.money.Money;
import uz.yuzplus.shared.security.Actor;

/** {@link TripMoney} — reys avansi va yo'l xarajatlari KO lari (HD2, SPEC 5.4). */
@Service
class TripMoneyOps implements TripMoney {

    static final String ADVANCE_OUT = "Haydovchiga avans";
    static final String ADVANCE_IN = "Haydovchi avansi qaytdi";

    /** Xarajat turi → tizim moddasi (V5, V114). */
    static final Map<Kind, String> ITEMS = Map.of(
            Kind.FUEL, "Transport va yoqilgʻi",
            Kind.MEAL, "Haydovchi ovqatlanishi",
            Kind.TOLL, "Yoʻl toʻlovi va parkovka",
            Kind.REPAIR, "Transport taʼmiri",
            Kind.OTHER, "Boshqa");

    private final JdbcClient jdbc;
    private final CashOps ops;
    private final Accounts accounts;
    private final CashierGuard cashiers;

    TripMoneyOps(JdbcClient jdbc, CashOps ops, Accounts accounts, CashierGuard cashiers) {
        this.jdbc = jdbc;
        this.ops = ops;
        this.accounts = accounts;
        this.cashiers = cashiers;
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public Posted issueAdvance(Actor actor, long branchId, long accountId, long driverId, String tripNumber, Money amount, String note) {
        positive(amount);
        Accounts.Account acc = cashAccount(branchId, accountId);
        cashiers.check(acc.id());
        CashOps.Posted ko = ops.system(actor, acc, Direction.OUT, ADVANCE_OUT, amount, employee(driverId), join(tripNumber, note), OpSource.ADVANCE);
        return new Posted(ko.id(), ko.number());
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public Posted returnAdvance(Actor actor, long branchId, long accountId, long driverId, String tripNumber, Money amount) {
        positive(amount);
        Accounts.Account acc = cashAccount(branchId, accountId);
        CashOps.Posted ko = ops.system(actor, acc, Direction.IN, ADVANCE_IN, amount, employee(driverId), tripNumber, OpSource.ADVANCE);
        return new Posted(ko.id(), ko.number());
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public Posted expense(Actor actor, long branchId, long accountId, long driverId, String tripNumber, Kind kind, Money amount, String note) {
        positive(amount);
        Accounts.Account acc = cashAccount(branchId, accountId);
        CashOps.Posted ko = ops.system(actor, acc, Direction.OUT, ITEMS.get(kind), amount, employee(driverId), join("Yoʻl xarajati · " + tripNumber, note),
                OpSource.TRIP_EXPENSE);
        return new Posted(ko.id(), ko.number());
    }

    private static void positive(Money amount) {
        if (!amount.isPositive()) {
            throw new IllegalArgumentException("Summa musbat bo'lishi kerak");
        }
    }

    private static String join(String a, String b) {
        return b == null || b.isBlank() ? a : a + " · " + b.strip();
    }

    private Accounts.Account cashAccount(long branchId, long accountId) {
        return accounts.find(accountId)
                .filter(a -> a.branchId() == branchId && a.active() && a.kind() == Accounts.Kind.CASH)
                .orElseThrow(() -> YuzplusException.badRequest("payment.cashAccountRequired"));
    }

    private String employee(long employeeId) {
        return jdbc.sql("SELECT full_name FROM employee WHERE id = :e").param("e", employeeId).query(String.class).optional()
                .orElseThrow(() -> YuzplusException.notFound("error.notFound"));
    }
}
