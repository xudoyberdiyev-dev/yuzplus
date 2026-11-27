-- TZ3: real vaqt signallari (V32/V36 davomi) — filial ustuni yoʻq jadvallar uchun filial ota hujjatdan olinadi.
-- «Muammolar» (sales_order_issue) → «orders» mavzusi; reys avansi/xarajati (trip_advance, trip_expense) → «trips» mavzusi.
-- Shunda Ombor mudiri panelidagi muammolar va Kassa → «Haydovchilardan naqd» (avans/xarajatli reyslar)
-- SSE ulanganda 15–30 s polling oʻrniga hodisa bilan yangilanadi. pg_notify tranzaksiya yakunlangachgina yetkaziladi.
CREATE FUNCTION yuzplus_order_child_live_signal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    b BIGINT;
BEGIN
    SELECT branch_id INTO b FROM sales_order WHERE id = NEW.order_id;
    IF b IS NOT NULL THEN
        PERFORM pg_notify('yuzplus_live', TG_ARGV[0] || ':' || b);
    END IF;
    RETURN NULL;
END
$$;

CREATE FUNCTION yuzplus_trip_child_live_signal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    b BIGINT;
BEGIN
    SELECT branch_id INTO b FROM trip WHERE id = NEW.trip_id;
    IF b IS NOT NULL THEN
        PERFORM pg_notify('yuzplus_live', TG_ARGV[0] || ':' || b);
    END IF;
    RETURN NULL;
END
$$;

CREATE TRIGGER sales_order_issue_live AFTER INSERT OR UPDATE ON sales_order_issue
    FOR EACH ROW EXECUTE FUNCTION yuzplus_order_child_live_signal('orders');

CREATE TRIGGER trip_advance_live AFTER INSERT OR UPDATE ON trip_advance
    FOR EACH ROW EXECUTE FUNCTION yuzplus_trip_child_live_signal('trips');

CREATE TRIGGER trip_expense_live AFTER INSERT OR UPDATE ON trip_expense
    FOR EACH ROW EXECUTE FUNCTION yuzplus_trip_child_live_signal('trips');
