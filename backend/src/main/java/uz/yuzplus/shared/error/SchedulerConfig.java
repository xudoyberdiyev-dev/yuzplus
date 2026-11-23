package uz.yuzplus.shared.error;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * Rejali vazifalar ijrochisi (S1 8-qism, 23.11.2026).
 *
 * <ul>
 *   <li>Standart ijrochi — bitta oqim: kunlik eslatmalar (08:00–08:10) ma'lumot ko'payganda uzoq ishlasa, real vaqt ulanishlarining
 *       25 soniyalik «ping»i kechikib, proksi ulanishlarni uzardi. Endi 3 ta oqim.</li>
 *   <li>Vazifa xatosi avval faqat logga yozilardi — endi «Tizim holati» jurnaliga ham (kunlik Telegram xulosasiga kiradi).</li>
 * </ul>
 */
@Configuration(proxyBeanMethods = false)
class SchedulerConfig {

    static final int POOL_SIZE = 3;

    private static final Logger log = LoggerFactory.getLogger(SchedulerConfig.class);

    /** Bean sifatida — kontekst yopilganda oqimlar to'xtatiladi (testlarda ham). */
    @Bean(name = "taskScheduler")
    ThreadPoolTaskScheduler taskScheduler(SystemErrors errors) {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(POOL_SIZE);
        scheduler.setThreadNamePrefix("yuzplus-job-");
        scheduler.setErrorHandler(e -> {
            String job = jobName(e);
            log.error("Rejali vazifa xatosi: {}", job, e);
            errors.record("SCHEDULED", job, e);
        });
        return scheduler;
    }

    /** Xato stekidagi birinchi loyiha metodi («Klass.metod») — qaysi vazifa yiqilganini ko'rsatish uchun. */
    static String jobName(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            for (StackTraceElement f : t.getStackTrace()) {
                if (f.getClassName().startsWith("uz.yuzplus.")) {
                    String cls = f.getClassName();
                    return cls.substring(cls.lastIndexOf('.') + 1) + "." + f.getMethodName();
                }
            }
        }
        return "?";
    }
}
