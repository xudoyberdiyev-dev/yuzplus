-- HD1: push bildirishnomalar (Expo Notifications). Mobil ilova kirgach qurilma tokenini yuboradi; bitta token — bitta xodim.
-- Bildirishnoma (notification jadvali) yozilganda shu xodimning faol tokenlariga push ketadi (commit dan keyin, fon oqimida).
CREATE TABLE device_token (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id   BIGINT        NOT NULL REFERENCES employee (id),
    token         VARCHAR(200)  NOT NULL UNIQUE,
    platform      VARCHAR(10)   NOT NULL CHECK (platform IN ('ANDROID', 'IOS')),
    active        BOOLEAN       NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX device_token_employee_idx ON device_token (employee_id) WHERE active;
