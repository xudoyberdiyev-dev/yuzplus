package uz.yuzplus.shared.error;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/** S1 8-qism: rejali vazifalar bir nechta oqimda, xato «Tizim holati» jurnaliga vazifa nomi bilan yoziladi. */
class SchedulerConfigTest {

    @Test
    void failedJobIsRecordedWithItsName() {
        SystemErrors errors = mock(SystemErrors.class);
        ThreadPoolTaskScheduler scheduler = new SchedulerConfig().taskScheduler(errors);
        scheduler.initialize();
        try {
            assertThat(scheduler.getScheduledThreadPoolExecutor().getCorePoolSize()).isEqualTo(SchedulerConfig.POOL_SIZE);
            IllegalStateException e = new IllegalStateException("sinov");
            scheduler.schedule(() -> {
                throw e;
            }, java.time.Instant.now());
            verify(errors, timeout(5000)).record(eq("SCHEDULED"), eq("SchedulerConfigTest.failedJobIsRecordedWithItsName"), eq(e));
        } finally {
            scheduler.shutdown();
        }
    }

    @Test
    void jobNameIsFirstProjectFrame() {
        RuntimeException outer = new RuntimeException(new IllegalStateException("ichki"));
        outer.setStackTrace(new StackTraceElement[] {new StackTraceElement("org.springframework.X", "run", null, 1)});
        outer.getCause().setStackTrace(new StackTraceElement[] {
            new StackTraceElement("java.lang.Thread", "run", null, 1),
            new StackTraceElement("uz.yuzplus.purchasing.receipt.ReceiptReminders", "daily", null, 1)});
        assertThat(SchedulerConfig.jobName(outer)).isEqualTo("ReceiptReminders.daily");
        RuntimeException bare = new RuntimeException();
        bare.setStackTrace(new StackTraceElement[0]);
        assertThat(SchedulerConfig.jobName(bare)).isEqualTo("?");
    }
}
