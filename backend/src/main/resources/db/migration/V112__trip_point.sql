-- HD1 (egasi 23.11.2026): GPS — «Yetib keldim» va bekat natijasida bir martalik joylashuv (fon kuzatuvi yoʻq).
-- Haydovchi ruxsat bermasa — yozilmaydi, ish davom etadi. Faqat qoʻshiladigan jurnal; rahbar reys kartasida koʻradi.
CREATE TABLE trip_point (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trip_id      BIGINT        NOT NULL REFERENCES trip (id),
    stop_id      BIGINT        REFERENCES trip_stop (id),
    kind         VARCHAR(12)   NOT NULL CHECK (kind IN ('ARRIVED', 'DELIVERED', 'PARTIAL', 'UNDELIVERED')),
    lat          NUMERIC(9, 6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng          NUMERIC(9, 6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
    accuracy_m   INT           CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
    recorded_at  TIMESTAMPTZ   NOT NULL,
    created_by   BIGINT        NOT NULL REFERENCES employee (id),
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX trip_point_trip_idx ON trip_point (trip_id, recorded_at);
CREATE TRIGGER trip_point_append_only BEFORE UPDATE OR DELETE ON trip_point
    FOR EACH ROW EXECUTE FUNCTION yuzplus_forbid_modification();
